// Muted, film-like gradient covers for the sample Reel tiles, to suit the paper palette.
const PALETTES: ReadonlyArray<readonly [string, string]> = [
  ["#d9a066", "#7d4424"], ["#9fb4a0", "#34503f"], ["#c3b2d6", "#523f73"], ["#e2c48c", "#8f6128"],
  ["#a2b7c8", "#384e63"], ["#d6a49c", "#7f403b"], ["#b9b48c", "#55512f"], ["#c79ab8", "#6a2f59"],
  ["#e0b07a", "#9a4f1c"], ["#8fb3b0", "#2f5552"],
];

/** Inline custom properties for a tile cover, deterministic per grid index. */
export function coverStyle(index: number): string {
  const [c1, c2] = PALETTES[(index * 3) % PALETTES.length]!;
  const angle = 150 + ((index * 23) % 50);
  const x = 25 + ((index * 31) % 50);
  const y = 20 + ((index * 17) % 40);
  return `--c1:${c1};--c2:${c2};--a:${angle}deg;--x:${x}%;--y:${y}%`;
}
