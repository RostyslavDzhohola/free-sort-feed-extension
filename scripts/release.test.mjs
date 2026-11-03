import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  EXIT,
  compareVersions,
  createJwt,
  cwsClient,
  manifestListingChanges,
  parseArgs,
  parseStoreDoc,
  redact,
  summarizeStatus,
  uploadDecision,
  verifyZipEntries,
  versionState,
} from "./release.mjs";

const status = (published, submitted, extra = {}) =>
  summarizeStatus({
    publishedItemRevisionStatus: published && { state: published[0], distributionChannels: [{ crxVersion: published[1], deployPercentage: 100 }] },
    submittedItemRevisionStatus: submitted && { state: submitted[0], distributionChannels: [{ crxVersion: submitted[1] }] },
    ...extra,
  });

test("compareVersions orders numerically, not as strings", () => {
  assert.equal(compareVersions("1.1.10", "1.1.9"), 1);
  assert.equal(compareVersions("1.1", "1.1.0"), 0);
  assert.equal(compareVersions("1.0.8", "1.1.1"), -1);
  assert.throws(() => compareVersions("1.x", "1.0"));
});

test("verifyZipEntries rejects extra and missing files, ignores directory entries", () => {
  const allow = ["manifest.json", "icons/icon16.png"];
  assert.deepEqual(verifyZipEntries(["icons/", "manifest.json", "icons/icon16.png"], allow), { ok: true, extra: [], missing: [] });
  const leaky = verifyZipEntries(["manifest.json", "icons/icon16.png", "icons/generated/big.png", "x.js.map"], allow);
  assert.equal(leaky.ok, false);
  assert.deepEqual(leaky.extra, ["icons/generated/big.png", "x.js.map"]);
  assert.deepEqual(verifyZipEntries(["manifest.json"], allow).missing, ["icons/icon16.png"]);
});

test("parseStoreDoc reads the dashboard and website sections", () => {
  const none = parseStoreDoc("# X\n\n## Dashboard changes needed\n\nNone\n\n## Website impact\n\nNone\n");
  assert.equal(none.hasDashboardSection, true);
  assert.equal(none.dashboardChanges, false);
  assert.equal(none.websiteChanges, false);
  const some = parseStoreDoc("## Dashboard changes needed\n\n- Store listing: description\n\n## Website impact\n\nFlip RELEASE_1_1\n");
  assert.equal(some.dashboardChanges, true);
  assert.equal(some.websiteChanges, true);
  assert.equal(some.websiteText, "Flip RELEASE_1_1");
  const missing = parseStoreDoc("## Store listing\n\ntext\n");
  assert.equal(missing.hasDashboardSection, false);
  assert.equal(missing.hasWebsiteSection, false);
});

test("manifestListingChanges flags the fields the listing and privacy tabs show", () => {
  const before = { version: "1.0.8", description: "a", permissions: ["storage"], host_permissions: ["x"] };
  assert.deepEqual(manifestListingChanges(before, { ...before, version: "1.0.9" }), []);
  assert.deepEqual(
    manifestListingChanges(before, { ...before, description: "b", optional_host_permissions: ["*://*.tiktok.com/*"] }),
    ["description", "optional_host_permissions"],
  );
});

test("versionState maps store states to exit codes", () => {
  assert.equal(versionState(status(["PUBLISHED", "1.1.1"], null), "1.1.1").code, EXIT.ok);
  assert.equal(versionState(status(["PUBLISHED", "1.0.8"], ["PENDING_REVIEW", "1.1.1"]), "1.1.1").code, EXIT.pending);
  assert.equal(versionState(status(["PUBLISHED", "1.0.8"], ["STAGED", "1.1.1"]), "1.1.1").code, EXIT.staged);
  assert.equal(versionState(status(["PUBLISHED", "1.0.8"], ["REJECTED", "1.1.1"]), "1.1.1").code, EXIT.rejected);
  assert.equal(versionState(status(["PUBLISHED", "1.0.8"], null), "1.1.1").state, "NOT_SUBMITTED");
});

test("versionState never reports a taken-down item as live", () => {
  const s = versionState(status(["PUBLISHED", "1.1.1"], null, { takenDown: true }), "1.1.1");
  assert.equal(s.code, EXIT.rejected);
  assert.equal(s.state, "TAKEN_DOWN");
});

test("uploadDecision: fresh version uploads", () => {
  assert.equal(uploadDecision(status(["PUBLISHED", "1.0.8"], null), "1.1.1").action, "upload");
  assert.equal(uploadDecision(status(["PUBLISHED", "1.0.8"], ["CANCELLED", "1.1.0"]), "1.1.1").action, "upload");
});

test("uploadDecision: an older version in review must be cancelled first", () => {
  const d = uploadDecision(status(["PUBLISHED", "1.0.8"], ["PENDING_REVIEW", "1.1.0"]), "1.1.1");
  assert.equal(d.action, "stop");
  assert.equal(d.cancellable, true);
  assert.match(d.reason, /cancel --confirm/);
});

test("uploadDecision: a newer version in review stops for Ros", () => {
  const d = uploadDecision(status(["PUBLISHED", "1.0.8"], ["PENDING_REVIEW", "1.2.0"]), "1.1.1");
  assert.equal(d.action, "stop");
  assert.equal(d.cancellable, undefined);
});

test("uploadDecision: re-running after a successful submit skips", () => {
  assert.equal(uploadDecision(status(["PUBLISHED", "1.0.8"], ["PENDING_REVIEW", "1.1.1"]), "1.1.1").action, "skip");
  assert.equal(uploadDecision(status(["PUBLISHED", "1.1.1"], null), "1.1.1").action, "skip");
});

test("uploadDecision: refuses a version not above the live one, and any takedown", () => {
  assert.equal(uploadDecision(status(["PUBLISHED", "1.1.1"], null), "1.1.0").action, "stop");
  assert.equal(uploadDecision(status(["PUBLISHED", "1.0.8"], null, { takenDown: true }), "1.1.1").action, "stop");
});

test("createJwt signs RS256 claims for the chromewebstore scope", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = {
    client_email: "release@p.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    private_key_id: "kid1",
    token_uri: "https://oauth2.googleapis.com/token",
  };
  const jwt = createJwt(key, 1000);
  const [h, c, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "RS256", typ: "JWT", kid: "kid1" });
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url")), {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/chromewebstore",
    aud: "https://oauth2.googleapis.com/token",
    iat: 1000,
    exp: 4600,
  });
  const v = createVerify("RSA-SHA256");
  v.update(`${h}.${c}`);
  assert.equal(v.verify(publicKey, sig, "base64url"), true);
});

test("redact hides tokens and keys", () => {
  const out = redact('Authorization: Bearer ya29.abc-DEF_1 {"access_token":"ya29.x","private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----"}');
  assert.doesNotMatch(out, /ya29|abc-DEF|BEGIN PRIVATE/);
});

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, ...init });
    const [status, body] = responses.shift();
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  return { impl, calls };
}

test("cwsClient sends the raw zip to the v2 upload endpoint", async () => {
  const { impl, calls } = fakeFetch([[200, { uploadState: "SUCCEEDED", crxVersion: "1.1.1" }]]);
  const cws = cwsClient({ publisherId: "pub", itemId: "item", getToken: async () => "tok", fetchImpl: impl });
  const res = await cws.upload(Buffer.from("zip"), "outliers-1.1.1.zip");
  assert.equal(res.crxVersion, "1.1.1");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://chromewebstore.googleapis.com/upload/v2/publishers/pub/items/item:upload");
  assert.equal(calls[0].headers.Authorization, "Bearer tok");
  assert.equal(calls[0].headers["X-Goog-Upload-Protocol"], "raw");
});

test("cwsClient publishes with the given request and never adds skipReview", async () => {
  const { impl, calls } = fakeFetch([[200, { state: "PENDING_REVIEW" }]]);
  const cws = cwsClient({ publisherId: "pub", itemId: "item", getToken: async () => "tok", fetchImpl: impl });
  await cws.publish({ publishType: "DEFAULT_PUBLISH", blockOnWarnings: false });
  assert.equal(calls[0].url, "https://chromewebstore.googleapis.com/v2/publishers/pub/items/item:publish");
  assert.deepEqual(JSON.parse(calls[0].body), { publishType: "DEFAULT_PUBLISH", blockOnWarnings: false });
});

test("cwsClient maps 403 to the auth exit code and 500 to the API exit code", async () => {
  const forbidden = fakeFetch([[403, { error: { message: "denied" } }]]);
  const cws = cwsClient({ publisherId: "pub", itemId: "item", getToken: async () => "tok", fetchImpl: forbidden.impl });
  await assert.rejects(cws.fetchStatus(), (e) => e.code === EXIT.auth && /Account/.test(e.message));
  const broken = fakeFetch([[500, {}]]);
  const cws2 = cwsClient({ publisherId: "pub", itemId: "item", getToken: async () => "tok", fetchImpl: broken.impl });
  await assert.rejects(cws2.fetchStatus(), (e) => e.code === EXIT.api);
});

test("parseArgs splits commands, positionals and flags", () => {
  assert.deepEqual(parseArgs(["publish", "1.1.1", "--listing-done"]), { command: "publish", args: ["1.1.1"], flags: { "listing-done": true } });
});
