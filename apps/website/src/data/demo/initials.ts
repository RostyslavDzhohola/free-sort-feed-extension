/** Avatar initials for a handle: "sample.studio" -> "SS", "heyrostyslav" -> "HE". Used when a snapshot has no profile photo. */
export function initialsFor(handle: string): string {
  const parts = handle.split(/[._]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : handle.slice(0, 2);
  return letters.toUpperCase();
}
