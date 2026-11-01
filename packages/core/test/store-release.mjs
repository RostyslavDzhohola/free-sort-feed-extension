// The website demos the extension version that's live in the Chrome Web Store, so @outliers/core
// mirrors that release, not the extension's working tree (which can be a version ahead).
// When a new version goes live in the store: bump STORE_RELEASE, port its changes into src/, and
// swap the website's panel replica in the same change.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const STORE_RELEASE = "v1.0.8";

const repoRoot = new URL("../../../", import.meta.url);

/** Extract the release's extension source to a temp dir; returns the path of its `src/`. */
export function extractStoreRelease(tag = STORE_RELEASE) {
  const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  // Releases up to 1.1.0 kept the extension at the repo root; later ones live in apps/extension/.
  const src = git("ls-tree", "--name-only", tag, "apps/extension/src").trim() ? "apps/extension/src" : "src";
  const dir = mkdtempSync(join(tmpdir(), "outliers-" + tag + "-"));
  const archive = execFileSync("git", ["archive", "--format=tar", tag, src], { cwd: repoRoot });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return join(dir, src);
}
