// Hot-reload helper for development only.
// Polls dist/ files for changes and calls chrome.runtime.reload() when detected.
// Started by background.ts and sidepanel.ts in watch mode.

const POLL_INTERVAL_MS = 1000;
let started = false;

async function getFileTimestamps(): Promise<string> {
  const files = [
    "sidepanel.js",
    "injected.js",
    "background.js",
    "sidepanel.html",
    "manifest.json",
  ];
  const timestamps: string[] = [];

  for (const file of files) {
    try {
      const url = chrome.runtime.getURL(file);
      const response = await fetch(url, { cache: "no-store" });
      const text = await response.text();
      timestamps.push(file + ":" + text.length + ":" + text);
    } catch {
      timestamps.push(file + ":error");
    }
  }

  return timestamps.join("|");
}

let lastFingerprint: string | null = null;

async function checkForChanges(): Promise<void> {
  const fingerprint = await getFileTimestamps();

  if (lastFingerprint === null) {
    // First run — just record the current state
    lastFingerprint = fingerprint;
    return;
  }

  if (fingerprint !== lastFingerprint) {
    console.log("[hot-reload] Change detected, reloading extension...");
    chrome.runtime.reload();
  }
}

export function startHotReload(): void {
  if (started) return;
  started = true;
  void checkForChanges();
  setInterval(checkForChanges, POLL_INTERVAL_MS);
  console.log("[hot-reload] Watching for changes...");
}
