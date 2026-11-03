// The website demos the extension version that's live in the Chrome Web Store, so @outliers/core
// mirrors that release, not the extension's working tree (which can be a version ahead).
// When a new version goes live in the store: bump STORE_RELEASE, port its changes into src/, and
// swap the website's panel replica in the same change.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const STORE_RELEASE = "v1.1.1";

const repoRoot = new URL("../../../", import.meta.url);

/** Extract the release's extension source to a temp dir; returns the path of its `src/`. */
export function extractStoreRelease(tag = STORE_RELEASE) {
  const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git("rev-parse", "--verify", "--quiet", tag + "^{commit}");
  } catch {
    // Shallow and single-branch clones skip older tags.
    throw new Error(`Tag ${tag} isn't in this clone. Fetch it with: git fetch --depth=1 origin tag ${tag}`);
  }
  // Releases up to 1.1.1 keep the extension at the repo root (src/); later ones live in apps/extension/.
  const src = git("ls-tree", "--name-only", tag, "apps/extension/src").trim() ? "apps/extension/src" : "src";
  const dir = mkdtempSync(join(tmpdir(), "outliers-" + tag + "-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const archive = execFileSync("git", ["archive", "--format=tar", tag, src], { cwd: repoRoot });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  return join(dir, src);
}
