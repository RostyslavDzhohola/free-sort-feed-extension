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
    const s = String(raw).trim().replace(/[\s, ]+/g, "");
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

  // The profile header names its owner in a text-only element ("mrbeast").
  const headers = document.querySelectorAll("main header, header");
  let header: Element | null = null;
  for (let i = 0; i < headers.length && !header; i++) {
    const nodes = headers[i]!.querySelectorAll("h1, h2, span, a, div");
    for (let j = 0; j < nodes.length; j++) {
      const node = nodes[j]!;
      if (node.children.length === 0 && node.textContent?.trim().toLowerCase() === username) {
        header = headers[i]!;
        break;
      }
    }
  }

  if (header) {
    // The count sits in an element whose whole text is "91.1M followers"; the exact
    // number, when shown, is in a nested title="91,161,216". Requiring the whole text
    // to match skips "Followed by j3ssicacao + 18 more", whose usernames hold digits.
    const candidates = header.querySelectorAll("a, span, div, li, button");
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i]!;
      const text = (el.textContent ?? "").replace(/ /g, " ").trim();
      const m = text.match(/^([\d.,]+\s*[KMBkmb]?)\s+followers?$/i);
      if (!m) continue;
      const titled = el.querySelector("[title]");
      const exact = parseCount(titled?.getAttribute("title"));
      if (!isNaN(exact) && exact > 0) return exact;
      const approx = parseCount(m[1]);
      if (!isNaN(approx) && approx > 0) return approx;
    }
    return null;
  }

  // No owned header yet. og:description is only server-rendered for the first page
  // load and is not updated by SPA navigation, so trust it only when it names this user.
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
