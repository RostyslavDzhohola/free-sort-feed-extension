import type { FilterMode, OutliersEntry, SavedReel } from "../types/state";

export interface CsvExportContext {
  profilePath: string | null;
  filterMode: FilterMode;
  thresholdLabel: string;
  exportedAt: string;
}

export interface SavedCsvExportContext {
  exportedAt: string;
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

export function buildOutliersCsv(outliers: OutliersEntry[], ctx: CsvExportContext): string {
  const rows: string[] = [];
  rows.push("rank,url,views,ratio,profile,filter_mode,threshold_label,exported_at");

  for (let i = 0; i < outliers.length; i++) {
    const reel = outliers[i]!;
    const row = [
      String(i + 1),
      escapeCsv(reel.url),
      String(reel.views),
      reel.ratio.toFixed(4),
      escapeCsv(ctx.profilePath ?? ""),
      ctx.filterMode,
      escapeCsv(ctx.thresholdLabel),
      escapeCsv(ctx.exportedAt),
    ];
    rows.push(row.join(","));
  }

  // UTF-8 BOM for Excel/Sheets compatibility.
  return "\uFEFF" + rows.join("\n");
}

export function buildSavedCsv(saved: SavedReel[], ctx: SavedCsvExportContext): string {
  const rows: string[] = [];
  rows.push("rank,url,views,multiplier,profile,saved_at,exported_at");

  for (let i = 0; i < saved.length; i++) {
    const reel = saved[i]!;
    const row = [
      String(i + 1),
      escapeCsv(reel.url),
      String(reel.views),
      reel.ratio.toFixed(4),
      escapeCsv(reel.profilePath ?? ""),
      escapeCsv(reel.savedAt),
      escapeCsv(ctx.exportedAt),
    ];
    rows.push(row.join(","));
  }

  return "\uFEFF" + rows.join("\n");
}
