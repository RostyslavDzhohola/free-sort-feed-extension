/**
 * Parse abbreviated count strings like "2.5K", "1,2M", "1M", "1,234" to numbers.
 * With a K/M/B suffix a single "." or "," is the decimal mark ("1,2M" is 1.2M), as is a last
 * mark that differs from the grouping marks before it ("1,234.5K" and "1.234,5K" are 1,234,500);
 * without a suffix every separator groups thousands ("1.234" is 1234).
 * Returns NaN if the string cannot be parsed.
 */
export function parseCount(raw: unknown): number {
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/[\s  ]+/g, "");
  const match = s.match(/^(\d+(?:[.,]\d+)*)([KMBkmb])?$/);
  if (!match) return NaN;
  const digits = match[1]!;
  const suffix = (match[2] ?? "").toUpperCase();
  let num: number;
  if (suffix) {
    const separators = digits.match(/[.,]/g) ?? [];
    const last = separators[separators.length - 1];
    const hasDecimal = last !== undefined && separators.slice(0, -1).every(function (mark) {
      return mark !== last;
    });
    if (hasDecimal) {
      const at = digits.lastIndexOf(last);
      num = parseFloat(digits.slice(0, at).replace(/[.,]/g, "") + "." + digits.slice(at + 1));
    } else {
      num = parseFloat(digits.replace(/[.,]/g, ""));
    }
  } else {
    num = parseInt(digits.replace(/[.,]/g, ""), 10);
  }
  if (isNaN(num)) return NaN;
  if (suffix === "K") num *= 1_000;
  else if (suffix === "M") num *= 1_000_000;
  else if (suffix === "B") num *= 1_000_000_000;
  return Math.round(num);
}
