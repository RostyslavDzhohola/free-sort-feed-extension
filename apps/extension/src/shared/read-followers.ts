/**
 * Read the follower count of the Instagram profile named in the page URL.
 *
 * Self-contained on purpose: the side panel passes it to chrome.scripting.executeScript,
 * which serializes the function, so it must not reference anything outside its body.
 *
 * Returns null when the page is not a profile, or when the profile header on screen
 * doesn't belong to the URL's user yet (Instagram's SPA navigation swaps the URL before
 * the header), so callers can retry instead of trusting a stale count.
 */
export function readProfileFollowers(): number | null {
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const reserved = ["explore", "p", "stories", "direct", "accounts", "reel", "reels"];
  if (reserved.includes(segments[0]!.toLowerCase())) return null;
  const username = segments[0]!.toLowerCase();

  function parseCount(raw: string | null | undefined): number {
    if (raw == null) return NaN;
    const s = String(raw).trim().replace(/[\s,\u00a0]+/g, "");
    const match = s.match(/^([\d.]+)([KMBkmb])?$/);
    if (!match) return NaN;
    let num = parseFloat(match[1]!);
    if (isNaN(num)) return NaN;
    const suffix = (match[2] ?? "").toUpperCase();
    if (suffix === "K") num *= 1000;
    else if (suffix === "M") num *= 1000000;
    else if (suffix === "B") num *= 1000000000;
    return Math.round(num);
  }

  // The profile header names its owner in its h2 heading ("mrbeast"). Display names and
  // bio lines can also equal a username, so only the heading establishes ownership.
  const headers = document.querySelectorAll("main header, header");
  let header: Element | null = null;
  for (let i = 0; i < headers.length && !header; i++) {
    const headings = headers[i]!.querySelectorAll("h1, h2");
    for (let j = 0; j < headings.length; j++) {
      if (headings[j]!.textContent?.trim().toLowerCase() === username) {
        header = headers[i]!;
        break;
      }
    }
  }

  if (header) {
    // The stat is an element whose whole text is "91.1M followers", with the number in a
    // nested element and the exact count, when shown, in title="91,161,216". Requiring
    // the whole text to match skips "Followed by j3ssicacao + 18 more", whose usernames
    // hold digits; requiring a nested element skips a display name like "1 follower".
    let approxCount = NaN;
    const candidates = header.querySelectorAll("a, span, div, li, button");
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i]!;
      if (el.children.length === 0 || el.closest("h1, h2")) continue;
      const text = (el.textContent ?? "").replace(/\u00a0/g, " ").trim();
      const m = text.match(/^([\d.,]+\s*[KMBkmb]?)\s+followers?$/i);
      if (!m) continue;
      const shown = parseCount(m[1]);
      const exact = parseCount(el.querySelector("[title]")?.getAttribute("title"));
      // Trust the title only when it agrees with the number shown (91,161,216 ≈ 91.1M).
      const agrees = isNaN(shown) || Math.abs(exact - shown) <= Math.max(shown * 0.1, 1);
      if (!isNaN(exact) && exact > 0 && agrees) return exact;
      if (isNaN(approxCount) && !isNaN(shown) && shown > 0) approxCount = shown;
    }
    if (!isNaN(approxCount)) return approxCount;
  }

  // No readable owned header (not rendered yet, or a layout we don't parse). og:description
  // is only server-rendered for the first page load and is not updated by SPA navigation,
  // so trust it only when it names this user.
  const meta = document.querySelector('meta[property="og:description"]');
  const content = meta?.getAttribute("content") ?? "";
  const owner = content.match(/\(@([A-Za-z0-9._]+)\)/);
  if (owner && owner[1]!.toLowerCase() === username) {
    const m = content.match(/([\d,.]+[KMBkmb]?)\s+Followers/i);
    const count = parseCount(m?.[1]);
    if (!isNaN(count) && count > 0) return count;
  }
  return null;
}
