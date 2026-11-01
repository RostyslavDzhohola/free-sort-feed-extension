export interface ProfileInfo {
  platform: "instagram" | "tiktok";
  /** Lowercase, without the @. */
  handle: string;
  /** The profile header on screen belongs to the URL's user. SPA navigation swaps the URL first. */
  headerMatches: boolean;
  followers: number | null;
  /** On the tab Outliers scans: Instagram's Reels tab, or TikTok's Videos tab. */
  onScanTab: boolean;
}

/**
 * Read the profile named in the page URL: whose header is on screen and its follower count.
 *
 * Self-contained on purpose: the side panel passes it to chrome.scripting.executeScript,
 * which serializes the function, so it must not reference anything outside its body.
 *
 * Run in the MAIN world it reads the exact count from the page's own data (Instagram's
 * Relay store, TikTok's React props), which works in every language. In the isolated
 * world those are invisible, so it falls back to the English "N followers" header text.
 *
 * Returns null when the page is not a profile.
 */
export function readProfileInfo(): ProfileInfo | null {
  const host = window.location.hostname.toLowerCase();
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  function parseCount(raw: string | null | undefined): number {
    if (raw == null) return NaN;
    const s = String(raw).trim().replace(/[\s  ]+/g, "");
    const match = s.match(/^(\d+(?:[.,]\d+)*)([KMBkmb])?$/);
    if (!match) return NaN;
    const digits = match[1]!;
    const suffix = (match[2] ?? "").toUpperCase();
    const separators = digits.match(/[.,]/g) ?? [];
    let num = suffix && separators.length === 1
      ? parseFloat(digits.replace(",", "."))
      : parseFloat(digits.replace(/[.,]/g, ""));
    if (isNaN(num)) return NaN;
    if (suffix === "K") num *= 1000;
    else if (suffix === "M") num *= 1000000;
    else if (suffix === "B") num *= 1000000000;
    return Math.round(num);
  }

  function toCount(raw: unknown): number | null {
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }

  function fiberOf(el: Element | null): { return: unknown; memoizedProps: unknown } | null {
    if (!el) return null;
    const key = Object.keys(el).find(function (k) {
      return k.startsWith("__reactFiber");
    });
    return key ? (el as unknown as Record<string, { return: unknown; memoizedProps: unknown }>)[key] ?? null : null;
  }

  // ── TikTok ──────────────────────────────────────────────────────────────
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const first = segments[0]!;
    if (!first.startsWith("@") || /^(video|photo)$/i.test(segments[1] ?? "")) return null;
    const handle = decodeURIComponent(first.slice(1)).toLowerCase();

    let headerMatches = false;
    const names = document.querySelectorAll('[data-e2e="user-title"], [data-e2e="user-subtitle"]');
    for (let i = 0; i < names.length; i++) {
      if ((names[i]!.textContent ?? "").trim().toLowerCase() === handle) headerMatches = true;
    }

    let followers: number | null = null;
    const countEl = document.querySelector('[data-e2e="followers-count"]');
    // React props above the count hold the profile's user and exact stats.
    try {
      let fiber = fiberOf(countEl) as { return: unknown; memoizedProps: unknown } | null;
      for (let depth = 0; fiber && depth < 40 && followers === null; depth++) {
        const props = fiber.memoizedProps as Record<string, unknown> | null;
        if (props && typeof props === "object") {
          for (const key of Object.keys(props)) {
            const value = props[key] as { user?: { uniqueId?: string }; stats?: Record<string, unknown>; statsV2?: Record<string, unknown> } | null;
            if (!value || typeof value !== "object" || !value.user || !value.stats) continue;
            const owner = String(value.user.uniqueId ?? "").toLowerCase();
            if (owner !== handle) {
              headerMatches = false;
              fiber = null;
              break;
            }
            headerMatches = true;
            followers = toCount(value.statsV2?.followerCount) ?? toCount(value.stats.followerCount);
            break;
          }
        }
        fiber = fiber ? (fiber.return as typeof fiber) : null;
      }
    } catch {
      // Not in the MAIN world, or TikTok changed its tree. Fall back to the page text.
    }

    if (followers === null) {
      // Server-rendered data covers the profile the tab first loaded; trust it only for this user.
      try {
        const script = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
        const data = script ? JSON.parse(script.textContent ?? "{}") : null;
        const info = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo;
        if (info && String(info.user?.uniqueId ?? "").toLowerCase() === handle) {
          followers = toCount(info.statsV2?.followerCount) ?? toCount(info.stats?.followerCount);
        }
      } catch {
        // Ignore malformed data
      }
    }

    if (followers === null && headerMatches && countEl) {
      const shown = parseCount(countEl.textContent);
      if (!isNaN(shown)) followers = shown;
    }

    const videosTab = document.querySelector('[data-e2e="videos-tab"]');
    const onScanTab = segments.length === 1 && (
      videosTab
        ? videosTab.getAttribute("aria-selected") === "true"
        : document.querySelector('[data-e2e="user-post-item"]') !== null
    );

    return { platform: "tiktok", handle, headerMatches, followers: headerMatches ? followers : null, onScanTab };
  }

  // ── Instagram ───────────────────────────────────────────────────────────
  const reserved = ["explore", "p", "stories", "direct", "accounts", "reel", "reels", "tv"];
  if (reserved.includes(segments[0]!.toLowerCase())) return null;
  if (segments.length > 1 && /^(reel|p)$/i.test(segments[1]!)) return null;
  const username = segments[0]!.toLowerCase();
  const onScanTab = segments.length === 2 && segments[1]!.toLowerCase() === "reels";

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
  if (!header) return { platform: "instagram", handle: username, headerMatches: false, followers: null, onScanTab };

  // Instagram keeps every loaded user in its Relay store; the record named by the URL has
  // the exact follower count, whatever language the page is in.
  try {
    const starts: Array<Element | null> = [header.querySelector("h1, h2"), header, document.querySelector("main")];
    for (let s = 0; s < starts.length; s++) {
      let fiber = fiberOf(starts[s] ?? null) as { return: unknown; memoizedProps: unknown } | null;
      let store: { getSource: () => { getRecordIDs: () => string[]; get: (id: string) => Record<string, unknown> | null } } | null = null;
      for (let depth = 0; fiber && depth < 200 && !store; depth++) {
        const props = fiber.memoizedProps as Record<string, unknown> | null;
        if (props && typeof props === "object") {
          for (const key of Object.keys(props)) {
            const value = props[key] as { getStore?: () => typeof store; environment?: { getStore?: () => typeof store } } | null;
            if (!value || typeof value !== "object") continue;
            if (typeof value.getStore === "function") store = value.getStore();
            else if (value.environment && typeof value.environment.getStore === "function") store = value.environment.getStore();
            if (store) break;
          }
        }
        fiber = fiber.return as typeof fiber;
      }
      if (!store) continue;
      const source = store.getSource();
      const ids = source.getRecordIDs();
      for (let i = 0; i < ids.length; i++) {
        const record = source.get(ids[i]!);
        if (!record || record.__typename !== "XDTUserDict") continue;
        if (String(record.username ?? "").toLowerCase() !== username) continue;
        const exact = toCount(record.follower_count);
        if (exact !== null) return { platform: "instagram", handle: username, headerMatches: true, followers: exact, onScanTab };
      }
      break;
    }
  } catch {
    // Not in the MAIN world, or Instagram changed its store. Fall back to the header text.
  }

  // The stat is an element whose whole text is "91.1M followers", with the number in a
  // nested element and the exact count, when shown, in title="91,161,216". Requiring
  // the whole text to match skips "Followed by j3ssicacao + 18 more", whose usernames
  // hold digits; requiring a nested element skips a display name like "1 follower".
  let approxCount = NaN;
  const candidates = header.querySelectorAll("a, span, div, li, button");
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i]!;
    if (el.children.length === 0 || el.closest("h1, h2")) continue;
    const text = (el.textContent ?? "").replace(/ /g, " ").trim();
    const m = text.match(/^([\d.,]+\s*[KMBkmb]?)\s+followers?$/i);
    if (!m) continue;
    const shown = parseCount(m[1]);
    const exact = parseCount(el.querySelector("[title]")?.getAttribute("title"));
    // Trust the title only when it agrees with the number shown (91,161,216 ≈ 91.1M).
    const agrees = isNaN(shown) || Math.abs(exact - shown) <= Math.max(shown * 0.1, 1);
    if (!isNaN(exact) && exact > 0 && agrees) {
      return { platform: "instagram", handle: username, headerMatches: true, followers: exact, onScanTab };
    }
    if (isNaN(approxCount) && !isNaN(shown) && shown > 0) approxCount = shown;
  }
  if (!isNaN(approxCount)) {
    return { platform: "instagram", handle: username, headerMatches: true, followers: approxCount, onScanTab };
  }

  // og:description is only server-rendered for the first page load and is not updated by
  // SPA navigation, so trust it only when it names this user.
  const meta = document.querySelector('meta[property="og:description"]');
  const content = meta?.getAttribute("content") ?? "";
  const owner = content.match(/\(@([A-Za-z0-9._]+)\)/);
  if (owner && owner[1]!.toLowerCase() === username) {
    const m = content.match(/([\d,.]+[KMBkmb]?)\s+Followers/i);
    const count = parseCount(m?.[1]);
    if (!isNaN(count) && count > 0) {
      return { platform: "instagram", handle: username, headerMatches: true, followers: count, onScanTab };
    }
  }
  return { platform: "instagram", handle: username, headerMatches: true, followers: null, onScanTab };
}
