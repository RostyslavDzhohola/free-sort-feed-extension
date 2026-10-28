/** Avatar initials for a handle: "sample.studio" -> "SS", "heyrostyslav" -> "HE". Used instead of profile photos. */
export function initialsFor(handle: string): string {
  const parts = handle.split(/[._]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : handle.slice(0, 2);
  return letters.toUpperCase();
}
