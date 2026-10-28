import type { FilterMode, OutliersEntry, SavedReel, SortDir, SortKey } from "../types/state";
import { engagementRate } from "./videos";

export interface CsvExportContext {
  profilePath: string | null;
  filterMode: FilterMode;
  thresholdLabel: string;
  exportedAt: string;
  followers?: number | null;
  sortKey?: SortKey;
  sortDir?: SortDir;
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

function num(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function ratio(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value.toFixed(4) : "";
}

function postedAt(entry: OutliersEntry): string {
  return typeof entry.postedAt === "number" ? new Date(entry.postedAt * 1000).toISOString() : "";
}

function metricColumns(entry: OutliersEntry): string[] {
  const engagement = engagementRate(entry);
  return [
    entry.platform ?? "instagram",
    num(entry.likes),
    num(entry.comments),
    num(entry.shares),
    num(entry.saves),
    engagement === null ? "" : engagement.toFixed(4),
    postedAt(entry),
    num(entry.durationSec),
  ];
}

const METRIC_HEADERS = "platform,likes,comments,shares,saves,engagement_rate,posted_at,duration_sec";

// The 1.0.x columns keep their names and positions so existing sheets keep working;
// 1.1 columns are appended after them.
export function buildOutliersCsv(outliers: OutliersEntry[], ctx: CsvExportContext): string {
  const rows: string[] = [];
  rows.push(
    "rank,url,views,ratio,profile,filter_mode,threshold_label,exported_at,"
      + METRIC_HEADERS
      + ",likes_hidden,followers,sort_by,sort_dir"
  );

  for (let i = 0; i < outliers.length; i++) {
    const reel = outliers[i]!;
    const row = [
      String(i + 1),
      escapeCsv(reel.url),
      num(reel.views),
      ratio(reel.ratio),
      escapeCsv(ctx.profilePath ?? ""),
      ctx.filterMode,
      escapeCsv(ctx.thresholdLabel),
      escapeCsv(ctx.exportedAt),
      ...metricColumns(reel),
      reel.likesHidden ? "true" : "false",
      num(ctx.followers ?? null),
      ctx.sortKey ?? "views",
      ctx.sortDir ?? "desc",
    ];
    rows.push(row.join(","));
  }

  // UTF-8 BOM for Excel/Sheets compatibility.
  return "﻿" + rows.join("\n");
}

export function buildSavedCsv(saved: SavedReel[], ctx: SavedCsvExportContext): string {
  const rows: string[] = [];
  rows.push("rank,url,views,multiplier,profile,saved_at,exported_at," + METRIC_HEADERS);

  for (let i = 0; i < saved.length; i++) {
    const reel = saved[i]!;
    const row = [
      String(i + 1),
      escapeCsv(reel.url),
      num(reel.views),
      ratio(reel.ratio),
      escapeCsv(reel.profilePath ?? ""),
      escapeCsv(reel.savedAt),
      escapeCsv(ctx.exportedAt),
      ...metricColumns(reel),
    ];
    rows.push(row.join(","));
  }

  return "﻿" + rows.join("\n");
}
