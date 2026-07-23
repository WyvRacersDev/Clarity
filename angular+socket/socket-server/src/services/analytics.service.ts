// analytics.ts
import express from "express";
import { sql } from "../infrastructure/db.js";
import { resolveUser } from "../repositories/identity.repository.js";

const router = express.Router();

const UNTAGGED = "__untagged__";

type SeriesEntry = { tag: string; data: number[] };

function isoDateYMD(d: Date) {
  // returns YYYY-MM-DD (local), consistent with the previous implementation.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function lastNDates(days: number): string[] {
  const arr: string[] = [];
  const today = new Date();
  // include today and go back days-1
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    arr.push(isoDateYMD(d));
  }
  return arr;
}

// --- Simple in-memory cache (30s), preserved from the original ---
let cache: {
  timestamp: number;
  days: number;
  username: string;
  completedPerDay: any;
  completionRateByTag: any;
} | null = null;

const CACHE_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Aggregate completion analytics for a single user, entirely in SQL.
 *
 * A "task instance" is one row of the `tasks` table together with each tag on
 * its parent ToDoLst element (content->'tags'); tasks with no tags fall into
 * the `__untagged__` bucket so every completed task is counted at least once.
 *
 *   completedPerDay      : per-day completion counts per tag (last `days` days)
 *   completionRateByTag  : onTime/total ratio per tag  (onTime = completion_time <= time)
 */
export async function aggregateAnalytics(days = 30, username: string) {
  const now = Date.now();
  if (
    cache &&
    now - cache.timestamp < CACHE_TTL_MS &&
    cache.days === days &&
    cache.username === username
  ) {
    return {
      completedPerDay: cache.completedPerDay,
      completionRateByTag: cache.completionRateByTag,
    };
  }

  console.log(
    `[analytics] aggregating analytics for past ${days} days for user "${username}"...`
  );

  const labels = lastNDates(days); // YYYY-MM-DD
  const dayIndex = new Map<string, number>();
  labels.forEach((d, i) => dayIndex.set(d, i));

  const countsByTag = new Map<string, number[]>();
  const countsSummary = new Map<
    string,
    { total: number; onTime: number; late: number }
  >();

  const owner = await resolveUser(username);
  if (owner) {
    // One row per (completed task, tag). COALESCE the tags array to a single
    // __untagged__ element so untagged tasks still produce a row.
    const rows = await sql<
      Array<{
        completion_ymd: string;
        tag: string;
        on_time: boolean;
      }>
    >`
      select to_char(t.completion_time, 'YYYY-MM-DD') as completion_ymd,
             coalesce(tag.value, ${UNTAGGED})          as tag,
             (t.time is not null and t.completion_time <= t.time) as on_time
      from tasks t
      join screen_elements se on se.id = t.element_id
      join grids g           on g.id  = se.grid_id
      join projects p        on p.id  = g.project_id
      left join lateral (
        select value
        from jsonb_array_elements_text(
          case when jsonb_typeof(se.content->'tags') = 'array'
                 and jsonb_array_length(se.content->'tags') > 0
               then se.content->'tags'
               else '[]'::jsonb
          end
        ) as value
      ) tag on true
      where p.owner_id = ${owner.id}
        and t.is_done = true
        and t.completion_time is not null
    `;

    for (const r of rows) {
      // Only count completions that fall inside the [today-days+1 .. today] window.
      if (!dayIndex.has(r.completion_ymd)) continue;
      const tag = r.tag ?? UNTAGGED;

      if (!countsByTag.has(tag)) {
        countsByTag.set(tag, new Array(days).fill(0));
        countsSummary.set(tag, { total: 0, onTime: 0, late: 0 });
      }
      const idx = dayIndex.get(r.completion_ymd);
      const counts = countsByTag.get(tag);
      if (idx !== undefined && counts) {
        counts[idx] = (counts[idx] ?? 0) + 1;
      }
      const summary = countsSummary.get(tag)!;
      summary.total += 1;
      if (r.on_time) summary.onTime += 1;
      else summary.late += 1;
    }
  } else {
    console.warn(`[analytics] user "${username}" not found; returning empty analytics.`);
  }

  // Build the per-day series, sorted by total completions desc (nicer display).
  const series: SeriesEntry[] = [];
  for (const [tag, arr] of countsByTag) {
    series.push({ tag, data: arr });
  }
  series.sort((a, b) => {
    const sumA = a.data.reduce((s, v) => s + v, 0);
    const sumB = b.data.reduce((s, v) => s + v, 0);
    return sumB - sumA;
  });

  // Build completion-rate-by-tag in the same tag order as the series.
  const labelsRate: string[] = [];
  const valuesRate: number[] = [];
  const countsObj: Record<
    string,
    { total: number; onTime: number; late: number }
  > = {};
  const seen = new Set<string>();
  for (const s of series) {
    const tag = s.tag;
    seen.add(tag);
    const summary = countsSummary.get(tag)!;
    labelsRate.push(tag);
    const pct = summary.total > 0 ? summary.onTime / summary.total : 0;
    valuesRate.push(pct);
    countsObj[tag] = { ...summary };
  }
  for (const [tag, summary] of countsSummary) {
    if (!seen.has(tag)) {
      labelsRate.push(tag);
      valuesRate.push(summary.total > 0 ? summary.onTime / summary.total : 0);
      countsObj[tag] = { ...summary };
    }
  }

  const completedPerDay = { labels, series };
  const completionRateByTag = {
    labels: labelsRate,
    values: valuesRate,
    counts: countsObj,
  };

  cache = {
    timestamp: Date.now(),
    days,
    username,
    completedPerDay,
    completionRateByTag,
  };

  return { completedPerDay, completionRateByTag };
}

export default router;
