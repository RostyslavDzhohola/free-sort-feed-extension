// Hot-reload service worker for development only.
// Polls dist/ files for changes and calls chrome.runtime.reload() when detected.
// This file is only included in the build when using `pnpm watch`.

const POLL_INTERVAL_MS = 1000;

async function getFileTimestamps(): Promise<string> {
  const files = ["popup.js", "injected.js", "popup.html"];
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

setInterval(checkForChanges, POLL_INTERVAL_MS);
console.log("[hot-reload] Watching for changes...");
