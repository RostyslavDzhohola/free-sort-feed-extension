/**
 * Parse abbreviated count strings like "2.5K", "1M", "1,234" to numbers.
 * Returns NaN if the string cannot be parsed.
 */
export function parseCount(raw: unknown): number {
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/[\s,\u00a0]+/g, "");
  const match = s.match(/^([\d.]+)\s*([KMBkmb])?$/);
  if (!match) return NaN;
  let num = parseFloat(match[1]!);
  if (isNaN(num)) return NaN;
  const suffix = (match[2] ?? "").toUpperCase();
  if (suffix === "K") num *= 1_000;
  else if (suffix === "M") num *= 1_000_000;
  else if (suffix === "B") num *= 1_000_000_000;
  return Math.round(num);
}

/**
 * Format a number as an abbreviated string: 1500 -> "1.5K"
 */
export function formatCount(n: number): string {
  if (n >= 1_000_000_000)
    return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
