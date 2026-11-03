#!/usr/bin/env node
// Outliers release tool: builds the extension from a git tag and ships it through the Chrome Web Store API v2.
// RELEASING.md is the runbook; this file is the mechanism. No dependencies beyond Node >= 22 and the
// `git`, `pnpm`, `zip` and `unzip` binaries.
//
// Every command prints one JSON object on stdout and exits with a code from EXIT.

import { createHash, createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXIT = {
  ok: 0,
  pending: 10, // in review
  staged: 11, // approved, waiting for a publish call
  rejected: 12, // rejected or cancelled
  auth: 20, // no key, bad key, or the service account isn't on the publisher
  precondition: 30, // a check failed; the message names it
  api: 40, // the store API returned an error
  gate: 50, // needs Ros: listing changes in the dashboard
};

export class ReleaseError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://chromewebstore.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";

// ---------- pure helpers (unit-tested) ----------

/** Compares dot-separated numeric versions. Returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  if ([...pa, ...pb].some((n) => !Number.isInteger(n) || n < 0)) {
    throw new ReleaseError(EXIT.precondition, `Not a version: ${a} / ${b}`);
  }
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function assertVersion(v) {
  if (!/^\d+(\.\d+){1,3}$/.test(String(v ?? ""))) {
    throw new ReleaseError(EXIT.precondition, `Expected a version like 1.2.3, got "${v ?? ""}"`);
  }
  return String(v);
}

/** Hides bearer tokens, access tokens and private keys in anything we print. */
export function redact(text) {
  return String(text)
    .replace(/Bearer\s+[\w.~+/-]+=*/g, "Bearer [redacted]")
    .replace(/ya29\.[\w.-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-key]")
    .replace(/"(access_token|private_key|assertion)"\s*:\s*"[^"]*"/g, '"$1":"[redacted]"');
}

/** Checks a zip's entry list against the exact allowlist: nothing missing, nothing extra. */
export function verifyZipEntries(entries, allowlist) {
  const files = entries.filter((e) => !e.endsWith("/"));
  const extra = files.filter((f) => !allowlist.includes(f));
  const missing = allowlist.filter((f) => !files.includes(f));
  return { ok: extra.length === 0 && missing.length === 0, extra, missing };
}

/** Reads the two required sections of a store doc. */
export function parseStoreDoc(markdown) {
  const section = (title) => {
    const m = markdown.match(new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"));
    return m ? m[1].trim() : null;
  };
  const dashboard = section("Dashboard changes needed");
  const website = section("Website impact");
  return {
    hasDashboardSection: dashboard !== null,
    hasWebsiteSection: website !== null,
    dashboardChanges: dashboard !== null && !/^none\b/i.test(dashboard),
    dashboardText: dashboard,
    websiteText: website,
    websiteChanges: website !== null && !/^none\b/i.test(website),
  };
}

const LISTING_KEYS = ["description", "permissions", "host_permissions", "optional_host_permissions", "optional_permissions"];

/** Manifest fields that feed the store's listing or privacy tabs and changed between two manifests. */
export function manifestListingChanges(before, after) {
  return LISTING_KEYS.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null));
}

/** Flattens fetchStatus into the fields we act on. */
export function summarizeStatus(s) {
  const rev = (r) =>
    r ? { state: r.state ?? null, version: r.distributionChannels?.[0]?.crxVersion ?? null } : null;
  return {
    published: rev(s.publishedItemRevisionStatus),
    submitted: rev(s.submittedItemRevisionStatus),
    lastAsyncUploadState: s.lastAsyncUploadState ?? null,
    takenDown: Boolean(s.takenDown),
    warned: Boolean(s.warned),
  };
}

/** Where a version stands in the store, as an exit code: 0 live, 10 in review, 11 staged, 12 rejected/cancelled. */
export function versionState(summary, version) {
  const { published, submitted } = summary;
  if (summary.takenDown) return { code: EXIT.rejected, state: "TAKEN_DOWN" };
  if (published?.version === version && published.state === "PUBLISHED") {
    return { code: EXIT.ok, state: "LIVE" };
  }
  if (submitted?.version === version) {
    if (submitted.state === "PENDING_REVIEW") return { code: EXIT.pending, state: "PENDING_REVIEW" };
    if (submitted.state === "STAGED") return { code: EXIT.staged, state: "STAGED" };
    if (submitted.state === "REJECTED" || submitted.state === "CANCELLED") {
      return { code: EXIT.rejected, state: submitted.state };
    }
    if (submitted.state === "PUBLISHED" || submitted.state === "PUBLISHED_TO_TESTERS") {
      return { code: EXIT.ok, state: submitted.state === "PUBLISHED" ? "LIVE" : submitted.state };
    }
  }
  return { code: EXIT.precondition, state: "NOT_SUBMITTED" };
}

/** Decides whether `upload` may run, given the store's state. */
export function uploadDecision(summary, version) {
  if (summary.takenDown || summary.warned) {
    return { action: "stop", code: EXIT.precondition, reason: "The item is taken down or has a policy warning. Ros decides." };
  }
  const { published, submitted } = summary;
  const live = versionState(summary, version);
  if (live.code === EXIT.ok || live.code === EXIT.pending || live.code === EXIT.staged) {
    return { action: "skip", code: EXIT.ok, reason: `${version} is already ${live.state} in the store.` };
  }
  if (published?.version && compareVersions(version, published.version) <= 0) {
    return { action: "stop", code: EXIT.precondition, reason: `The store already serves ${published.version}; ${version} must be higher. Bump the version.` };
  }
  if (submitted && ["PENDING_REVIEW", "STAGED"].includes(submitted.state) && submitted.version !== version) {
    if (submitted.version && compareVersions(submitted.version, version) < 0) {
      return { action: "stop", code: EXIT.precondition, reason: `${submitted.version} is ${submitted.state}. It's older than ${version}: run \`pnpm release cancel --confirm\`, then upload again.`, cancellable: true };
    }
    return { action: "stop", code: EXIT.precondition, reason: `${submitted.version} is ${submitted.state} and isn't older than ${version}. Ask Ros.` };
  }
  return { action: "upload", code: EXIT.ok };
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

/** Builds the signed JWT a service account exchanges for an access token. */
export function createJwt(key, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.private_key_id }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: key.token_uri || TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(key.private_key, "base64url")}`;
}

// ---------- store API client ----------

export function cwsClient({ publisherId, itemId, getToken, fetchImpl = fetch }) {
  const item = `publishers/${publisherId}/items/${itemId}`;
  async function call(method, url, { body, headers = {} } = {}) {
    const token = await getToken();
    let res;
    try {
      res = await fetchImpl(url, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers } });
    } catch (err) {
      throw new ReleaseError(EXIT.api, `Network error calling ${url}: ${err.message}`);
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? EXIT.auth : EXIT.api;
      const hint =
        code === EXIT.auth
          ? " Check that the service account's email is added under Developer Dashboard > Account, and that the publisher ID is right."
          : res.status === 404
            ? " Check publisherId and itemId in release.config.json."
            : "";
      throw new ReleaseError(code, `${method} ${url.replace(API, "")} returned ${res.status}.${hint}`, json);
    }
    return json;
  }
  return {
    fetchStatus: () => call("GET", `${API}/v2/${item}:fetchStatus`),
    upload: (zipBytes, fileName) =>
      call("POST", `${API}/upload/v2/${item}:upload`, {
        body: zipBytes,
        headers: {
          "Content-Type": "application/zip",
          "X-Goog-Upload-Protocol": "raw",
          "X-Goog-Upload-File-Name": fileName,
        },
      }),
    publish: (request) =>
      call("POST", `${API}/v2/${item}:publish`, {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
      }),
    cancelSubmission: () =>
      call("POST", `${API}/v2/${item}:cancelSubmission`, { body: "{}", headers: { "Content-Type": "application/json" } }),
  };
}

// ---------- environment ----------

function loadConfig() {
  const config = JSON.parse(readFileSync(join(ROOT, "release.config.json"), "utf8"));
  config.publisherId = process.env.CWS_PUBLISHER_ID || config.publisherId;
  config.keyPath = (process.env.CWS_KEY_PATH || config.keyPath).replace(/^~(?=\/)/, homedir());
  return config;
}

function loadKey(config) {
  if (!existsSync(config.keyPath)) {
    throw new ReleaseError(EXIT.auth, `No service account key at ${config.keyPath}. One-time setup: see RELEASING.md.`);
  }
  const mode = statSync(config.keyPath).mode & 0o777;
  if (mode & 0o077) {
    throw new ReleaseError(EXIT.auth, `${config.keyPath} is readable by others (mode ${mode.toString(8)}). Run chmod 600 on it.`);
  }
  const key = JSON.parse(readFileSync(config.keyPath, "utf8"));
  if (key.type !== "service_account" || !key.client_email || !key.private_key) {
    throw new ReleaseError(EXIT.auth, `${config.keyPath} isn't a service account JSON key.`);
  }
  return key;
}

function tokenProvider(config, fetchImpl = fetch) {
  let cached;
  return async () => {
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const key = loadKey(config);
    const res = await fetchImpl(key.token_uri || TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: createJwt(key) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      throw new ReleaseError(EXIT.auth, `Google refused the service account key (${res.status} ${json.error ?? ""}: ${json.error_description ?? ""}). The key may be deleted or disabled; make a new one.`);
    }
    cached = { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}

function client(config) {
  if (!config.publisherId) {
    throw new ReleaseError(EXIT.precondition, "publisherId is empty in release.config.json. Copy it from Developer Dashboard > Account.");
  }
  return cwsClient({ publisherId: config.publisherId, itemId: config.itemId, getToken: tokenProvider(config) });
}

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20, ...opts });
  } catch (err) {
    const tail = `${err.stdout ?? ""}${err.stderr ?? ""}`.split("\n").slice(-30).join("\n");
    throw new ReleaseError(EXIT.precondition, `${cmd} ${args.join(" ")} failed`, { log: redact(tail) });
  }
}

const git = (...args) => run("git", args).trim();

function gitShowJson(ref, path) {
  try {
    return JSON.parse(git("show", `${ref}:${path}`));
  } catch {
    return null;
  }
}

/** The extension's directory at a ref: apps/extension on the monorepo, the repo root on older tags. */
function extensionDirAt(config, ref) {
  for (const dir of config.extensionDirs) {
    const prefix = dir === "." ? "" : `${dir}/`;
    if (gitShowJson(ref, `${prefix}src/manifest.json`)) return dir;
  }
  throw new ReleaseError(EXIT.precondition, `No src/manifest.json at ${ref} in ${config.extensionDirs.join(", ")}`);
}

function manifestAt(config, ref) {
  const dir = extensionDirAt(config, ref);
  const prefix = dir === "." ? "" : `${dir}/`;
  return { dir, manifest: gitShowJson(ref, `${prefix}src/manifest.json`), pkg: gitShowJson(ref, `${prefix}package.json`) };
}

const outDir = (version) => join(ROOT, "release-out", version);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readStoreDoc(config, version) {
  const path = join(ROOT, config.storeDocDir, `chrome-web-store-${version}.md`);
  if (!existsSync(path)) {
    throw new ReleaseError(EXIT.precondition, `Missing store doc ${config.storeDocDir}/chrome-web-store-${version}.md`);
  }
  const doc = parseStoreDoc(readFileSync(path, "utf8"));
  if (!doc.hasDashboardSection || !doc.hasWebsiteSection) {
    throw new ReleaseError(EXIT.precondition, `The store doc needs both "## Dashboard changes needed" and "## Website impact" sections.`);
  }
  return { path, ...doc };
}

/** The listing gate: the store doc asks for dashboard changes, or the manifest changed fields the listing shows. */
function listingGate(config, version, publishedVersion) {
  const doc = readStoreDoc(config, version);
  const reasons = [];
  if (doc.dashboardChanges) reasons.push("store doc lists dashboard changes");
  const baseTag = publishedVersion && git("tag", "-l", `v${publishedVersion}`) ? `v${publishedVersion}` : null;
  if (baseTag) {
    const changed = manifestListingChanges(manifestAt(config, baseTag).manifest, manifestAt(config, `v${version}`).manifest);
    if (changed.length) reasons.push(`manifest changed since ${baseTag}: ${changed.join(", ")}`);
  } else {
    reasons.push(`no tag for the live version ${publishedVersion ?? "(unknown)"}, so the manifest can't be compared`);
  }
  return { needed: reasons.length > 0, reasons, storeDoc: doc.path.replace(`${ROOT}/`, ""), dashboardText: doc.dashboardText, website: doc.websiteText };
}

// ---------- commands ----------

async function doctor(config) {
  const out = { itemId: config.itemId, publisherId: config.publisherId || null, keyPath: config.keyPath };
  const status = summarizeStatus(await client(config).fetchStatus());
  out.store = status;
  for (const [name, cmd, args] of [["gh", "gh", ["auth", "status"]], ["vercel", "vercel", ["whoami"]]]) {
    try {
      execFileSync(cmd, args, { stdio: "ignore" });
      out[name] = "ok";
    } catch {
      out[name] = "not signed in";
    }
  }
  return out;
}

async function status(config, version) {
  const summary = summarizeStatus(await client(config).fetchStatus());
  if (!version) return summary;
  const { code, state } = versionState(summary, assertVersion(version));
  return { result: { version, state, ...summary }, code };
}

function bump(config, version) {
  assertVersion(version);
  const dir = join(ROOT, config.extensionDirs[0]);
  const files = [join(dir, "package.json"), join(dir, "src/manifest.json")];
  const current = JSON.parse(readFileSync(files[1], "utf8")).version;
  if (compareVersions(version, current) <= 0) {
    throw new ReleaseError(EXIT.precondition, `${version} isn't higher than the current ${current}`);
  }
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    writeFileSync(f, text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
  }
  const docPath = join(ROOT, config.storeDocDir, `chrome-web-store-${version}.md`);
  let createdDoc = false;
  if (!existsSync(docPath)) {
    writeFileSync(
      docPath,
      `# Chrome Web Store: Outliers ${version}\n\n## What's new\n\n- \n\n## Dashboard changes needed\n\nNone\n\n## Website impact\n\nNone\n`,
    );
    createdDoc = true;
  }
  return { version, from: current, edited: files.map((f) => f.replace(`${ROOT}/`, "")), storeDoc: docPath.replace(`${ROOT}/`, ""), createdDoc };
}

/** The release's tag: it exists, sits on origin/main, and carries the version in both files. Returns its commit. */
function verifyTag(config, version) {
  assertVersion(version);
  const tag = `v${version}`;
  git("fetch", "--quiet", "origin", "--tags");
  if (!git("tag", "-l", tag)) throw new ReleaseError(EXIT.precondition, `Tag ${tag} doesn't exist. Merge the release PR, then tag the merge commit.`);
  const commit = git("rev-parse", `${tag}^{commit}`);
  try {
    git("merge-base", "--is-ancestor", commit, "origin/main");
  } catch {
    throw new ReleaseError(EXIT.precondition, `${tag} (${commit.slice(0, 7)}) isn't on origin/main.`);
  }
  const { dir, manifest, pkg } = manifestAt(config, commit);
  if (manifest.version !== version || pkg?.version !== version) {
    throw new ReleaseError(EXIT.precondition, `At ${tag}, manifest.json says ${manifest.version} and package.json says ${pkg?.version}; both must be ${version}.`);
  }
  return { tag, commit, dir };
}

async function preflight(config, version) {
  const { tag, commit, dir } = verifyTag(config, version);
  const summary = summarizeStatus(await client(config).fetchStatus());
  const decision = uploadDecision(summary, version);
  if (decision.action === "stop" && !decision.cancellable) throw new ReleaseError(decision.code, decision.reason, summary);
  return {
    version,
    tag,
    commit,
    extensionDir: dir,
    store: summary,
    upload: decision,
    listingGate: listingGate(config, version, summary.published?.version),
  };
}

function build(config, version) {
  const { tag, commit, dir } = verifyTag(config, version);
  const out = outDir(version);
  const zipName = `outliers-${version}.zip`;
  const zipPath = join(out, zipName);
  // Replace only the build. upload.json stays: publish compares it with the new build and asks for a
  // fresh upload if they differ.
  mkdirSync(out, { recursive: true });
  for (const f of [zipPath, join(out, "build.json")]) rmSync(f, { force: true });
  // Outside the repo: inside it, pnpm would treat the main checkout's workspace as the root and skip
  // installing the tag's own dependencies.
  const parent = mkdtempSync(join(tmpdir(), `outliers-release-${version}-`));
  const work = join(parent, "work");
  try {
    git("worktree", "add", "--detach", work, commit);
    const ext = join(work, dir);
    run("pnpm", ["install", "--frozen-lockfile"], { cwd: work });
    for (const script of ["typecheck", "lint", "test", "build"]) {
      run("pnpm", ["run", "--if-present", script], { cwd: ext });
    }
    run("zip", ["-X", "-D", "-q", "-r", zipPath, ".", "-x", "*.map", "-x", "*.DS_Store"], { cwd: join(ext, "dist") });
    const entries = run("unzip", ["-Z1", zipPath]).split("\n").filter(Boolean);
    const check = verifyZipEntries(entries, config.zipAllowlist);
    if (!check.ok) {
      throw new ReleaseError(EXIT.precondition, `The zip doesn't match zipAllowlist in release.config.json.`, check);
    }
    const zipManifest = JSON.parse(run("unzip", ["-p", zipPath, "manifest.json"]));
    if (zipManifest.version !== version) {
      throw new ReleaseError(EXIT.precondition, `The zip's manifest says ${zipManifest.version}, not ${version}.`);
    }
    const bytes = readFileSync(zipPath);
    if (bytes.length > config.zipMaxBytes) {
      throw new ReleaseError(EXIT.precondition, `The zip is ${bytes.length} bytes, over zipMaxBytes (${config.zipMaxBytes}).`);
    }
    const record = { version, tag, commit, zip: zipPath.replace(`${ROOT}/`, ""), bytes: bytes.length, sha256: sha256(bytes), files: entries.length, builtAt: new Date().toISOString() };
    writeFileSync(join(out, "build.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    try {
      git("worktree", "remove", "--force", work);
    } catch {
      // Not registered, or removal failed: delete the files, then let git drop the registration.
    } finally {
      rmSync(parent, { recursive: true, force: true });
      git("worktree", "prune");
    }
  }
}

function readBuild(version) {
  const path = join(outDir(version), "build.json");
  if (!existsSync(path)) throw new ReleaseError(EXIT.precondition, `No build for ${version}. Run \`pnpm release build ${version}\` first.`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  const bytes = readFileSync(join(ROOT, record.zip));
  if (sha256(bytes) !== record.sha256) throw new ReleaseError(EXIT.precondition, `${record.zip} changed since it was built. Rebuild.`);
  return { record, bytes };
}

const lastUploadPath = () => join(ROOT, "release-out", "last-upload.json");

async function upload(config, version, { pollMs = 5000, maxPolls = 60 } = {}) {
  const { commit } = verifyTag(config, version);
  const { record, bytes } = readBuild(version);
  if (record.commit !== commit) {
    throw new ReleaseError(EXIT.precondition, `The build is from ${record.commit.slice(0, 7)}, but v${version} now points at ${commit.slice(0, 7)}. Rebuild.`);
  }
  const cws = client(config);
  const summary = summarizeStatus(await cws.fetchStatus());
  const decision = uploadDecision(summary, version);
  if (decision.action === "stop") throw new ReleaseError(decision.code, decision.reason, summary);
  if (decision.action === "skip") return { version, skipped: decision.reason, store: summary };

  let res = await cws.upload(bytes, `outliers-${version}.zip`);
  for (let i = 0; res.uploadState === "IN_PROGRESS" && i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const s = await cws.fetchStatus();
    if (s.lastAsyncUploadState && s.lastAsyncUploadState !== "IN_PROGRESS") res = { ...res, uploadState: s.lastAsyncUploadState };
  }
  if (res.uploadState !== "SUCCEEDED") throw new ReleaseError(EXIT.api, `Upload ended in state ${res.uploadState}.`, res);
  if (res.crxVersion && res.crxVersion !== version) {
    throw new ReleaseError(EXIT.api, `The store read version ${res.crxVersion} from the upload, not ${version}.`, res);
  }
  const uploaded = { version, commit, sha256: record.sha256, uploadState: res.uploadState, crxVersion: res.crxVersion ?? null, uploadedAt: new Date().toISOString() };
  writeFileSync(join(outDir(version), "upload.json"), `${JSON.stringify(uploaded, null, 2)}\n`);
  // The store keeps one draft per item, and publish submits whatever was uploaded last.
  writeFileSync(lastUploadPath(), `${JSON.stringify(uploaded, null, 2)}\n`);
  return uploaded;
}

async function cancel(config, confirmed) {
  if (!confirmed) throw new ReleaseError(EXIT.precondition, "cancel withdraws the submission under review. Re-run with --confirm.");
  const cws = client(config);
  const before = summarizeStatus(await cws.fetchStatus());
  if (!before.submitted || !["PENDING_REVIEW", "STAGED"].includes(before.submitted.state)) {
    return { cancelled: false, reason: "Nothing is under review.", store: before };
  }
  await cws.cancelSubmission();
  return { cancelled: before.submitted.version, store: summarizeStatus(await cws.fetchStatus()) };
}

async function publish(config, version, flags) {
  assertVersion(version);
  const cws = client(config);
  const summary = summarizeStatus(await cws.fetchStatus());
  const state = versionState(summary, version);
  if (state.code === EXIT.ok || state.code === EXIT.pending) {
    return { version, skipped: `${version} is already ${state.state}.`, store: summary };
  }
  if (state.code === EXIT.rejected && state.state === "TAKEN_DOWN") {
    throw new ReleaseError(EXIT.rejected, "The item is taken down. Ros decides.", summary);
  }
  // A staged version was approved already; publishing it again releases it.
  if (state.code !== EXIT.staged) {
    const readReceipt = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
    const receipt = readReceipt(join(outDir(version), "upload.json"));
    const last = readReceipt(lastUploadPath());
    if (!receipt) throw new ReleaseError(EXIT.precondition, `No upload on record for ${version}. Run \`pnpm release upload ${version}\` first.`);
    if (receipt.sha256 !== readBuild(version).record.sha256) {
      throw new ReleaseError(EXIT.precondition, "The uploaded zip and the current build differ. Upload again.");
    }
    if (last?.version !== version || last?.sha256 !== receipt.sha256) {
      throw new ReleaseError(EXIT.precondition, `The store's draft is ${last?.version ?? "unknown"}, not this build of ${version}. Upload ${version} again.`);
    }
    const gate = listingGate(config, version, summary.published?.version);
    if (gate.needed && !flags["listing-done"]) {
      throw new ReleaseError(EXIT.gate, `Listing gate: Ros updates the dashboard from ${gate.storeDoc}, then re-run with --listing-done.`, gate);
    }
  }
  const request = { publishType: flags.staged ? "STAGED_PUBLISH" : "DEFAULT_PUBLISH", blockOnWarnings: Boolean(flags["block-on-warnings"]) };
  const res = await cws.publish(request);
  const after = summarizeStatus(await cws.fetchStatus());
  const result = versionState(after, version);
  if (![EXIT.ok, EXIT.pending, EXIT.staged].includes(result.code)) {
    throw new ReleaseError(EXIT.api, `Publish returned, but the store doesn't show ${version} as submitted.`, { response: res, store: after });
  }
  return { version, request, state: res.state ?? null, warnings: res.warningInfo?.warnings ?? [], store: after };
}

// ---------- CLI ----------

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v ?? true;
    } else positional.push(a);
  }
  return { command: positional[0], args: positional.slice(1), flags };
}

const USAGE = `pnpm release <command>
  doctor                       prove the key works; show the store's state
  status [X.Y.Z]               store state; with a version, exit 0 live / 10 review / 11 staged / 12 rejected
  bump X.Y.Z                   set the extension's version; add a store doc skeleton
  preflight X.Y.Z              check the tag, versions, store state and listing gate
  build X.Y.Z                  build from tag vX.Y.Z in a clean worktree; zip and verify
  upload X.Y.Z                 upload the built zip
  cancel --confirm             withdraw the submission under review
  publish X.Y.Z [--listing-done] [--staged] [--block-on-warnings]`;

async function main(argv) {
  const { command, args, flags } = parseArgs(argv);
  const config = loadConfig();
  switch (command) {
    case "doctor": return doctor(config);
    case "status": return status(config, args[0]);
    case "bump": return bump(config, args[0]);
    case "preflight": return preflight(config, args[0]);
    case "build": return build(config, args[0]);
    case "upload": return upload(config, args[0]);
    case "cancel": return cancel(config, flags.confirm);
    case "publish": return publish(config, args[0], flags);
    default:
      throw new ReleaseError(EXIT.precondition, command ? `Unknown command ${command}.\n${USAGE}` : USAGE);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (out) => {
      const { result, code } = out && "code" in out && "result" in out ? out : { result: out, code: EXIT.ok };
      process.stdout.write(`${redact(JSON.stringify({ ok: code === EXIT.ok, exit: code, ...result }, null, 2))}\n`);
      process.exit(code);
    },
    (err) => {
      const code = err instanceof ReleaseError ? err.code : 1;
      process.stdout.write(`${redact(JSON.stringify({ ok: false, exit: code, error: err.message, details: err.details }, null, 2))}\n`);
      process.exit(code);
    },
  );
}
