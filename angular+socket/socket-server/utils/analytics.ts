// analytics.ts
import express from "express";
import fs from "fs/promises";
import path from "path";
import {Project, Grid} from "../../shared_models/dist/project.model.js"
import {scheduled_task}from "../../shared_models/dist/screen_elements.model.js"
import { ProjectHandler } from "./project_handler.ts";

const router = express.Router();
const project_handler= new ProjectHandler();

const PROJECTS_DIR = path.join(process.cwd(), "data", "projects"); // adjust to your folder
const UNTAGGED = "__untagged__";

type ModTask = {
  task:scheduled_task,
  tag: string[]
};

type SeriesEntry = { tag: string; data: number[] };

function isoDateYMD(d: Date) {
  // returns YYYY-MM-DD in UTC-like string (we only group by dates, timezone is not critical)
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

// --- Simple in-memory cache ---
let cache: {
  timestamp: number;
  days: number;
  completedPerDay: any;
  completionRateByTag: any;
} | null = null;

const CACHE_TTL_MS = 30 * 1000; // 30 seconds; tune as needed

async function loadProjectFiles(): Promise<any[]> {
  try {
    const files = await fs.readdir(PROJECTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith(".json"));
    const projects = [];
    for (const f of jsonFiles) {
      const filePath = path.join(PROJECTS_DIR, f);
      const content = await fs.readFile(filePath, "utf-8");
      try {
        projects.push(JSON.parse(content));
      } catch (err) {
        console.warn(`[analytics] failed to parse ${f}:`, err);
      }
    }
    return projects;
  } catch (err) {
    console.error("[analytics] error reading projects dir:", err);
    return [];
  }
}

function extractTasksFromProject(project: Project): ModTask[] {
  const tasks: ModTask[] = [];
  if (!project) return tasks;
  //console.log(`[analytics] extracting tasks from project:`, project);
  for (const grid of project.grid) {
    //console.log(`[analytics] processing grid:`, grid);
    if (!Array.isArray(grid.Screen_elements)) continue;
    for (const Screen_element of grid.Screen_elements) {
      if (!Screen_element) continue;
      if (Array.isArray(Screen_element.scheduled_tasks)) {
        for (const task of Screen_element.scheduled_tasks) {
          // keep tags on the parent element (el.tags) together with task
          //console.log(`[analytics] found task:`, task);
          const new_task: ModTask = {
            task: task,
            tag: []
          };
          // attach tags array to the task object if present on parent ToDoLst
          if (Array.isArray(Screen_element.tags)) {
            new_task.tag = Screen_element.tags;
          }else
            new_task.tag=[UNTAGGED];
          tasks.push(new_task);
        }
      }
    }
  }
  return tasks;
}

function parseISODateOrNull(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

export async function aggregateAnalytics(days = 30) {
  const now = Date.now();
  if (cache && (now - cache.timestamp) < CACHE_TTL_MS && cache.days === days) {
    return {
      completedPerDay: cache.completedPerDay,
      completionRateByTag: cache.completionRateByTag
    };
  }

//  const projects = await loadProjectFiles();
    const projects= project_handler.listProjects("local").projects;
    projects.concat(project_handler.listProjects("hosted").projects);
    //console.log(`[analytics] loaded ${projects.length} projects for analytics.`);
  const tasks: ModTask[] = [];
  for (const p of projects) {
    const proj_object=project_handler.loadProject(p.name,p.projectType).project;
    if(!proj_object){
      console.warn(`[analytics] failed to load project ${p.name}, skipping.`);
      continue;
    }
    const extracted = extractTasksFromProject(proj_object);
    //console.log(`[analytics] extracted ${extracted.length} tasks from project.`);
    tasks.push(...extracted);
  }

  const labels = lastNDates(days); // YYYY-MM-DD
  const dayIndex = new Map<string, number>(); // map date -> index
  labels.forEach((d, i) => dayIndex.set(d, i));

  // maps tag -> array[days] counts
  const countsByTag = new Map<string, number[]>();
  // maps tag -> { total, onTime, late }
  const countsSummary = new Map<string, { total: number; onTime: number; late: number }>();

  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - (days - 1));
  // go through tasks and collect those completed within timeframe
  for (const t of tasks) {
    //console.log(`[analytics] processing task:`, t);
    const isDone = !!t.task.is_done;
    const completion = parseISODateOrNull(t.task.completion_time ?? null);
    if (!isDone || !completion) continue; // only completed tasks count for the time-series

    // only include if completion date  is >= earliestDate
    const completionDateYMD = isoDateYMD(completion);
    if (!dayIndex.has(completionDateYMD)) {
      // completed outside window -> ignore for per-day chart, but might want to include in counts?
      continue;
    }

    // tags can be on the task or on parent element; normalize to array
    const tags: string[] = (t as any).tag && Array.isArray((t as any).tag) && (t as any).tag.length > 0
      ? (t as any).tag
      : [UNTAGGED];

    // determine "on time" vs "late"
    const scheduled = parseISODateOrNull(t.task.time ?? null); // treated as deadline
    const onTime = scheduled ? (completion.getTime() <= scheduled.getTime()) : false;

    for (const tag of tags) {
     // console.log(`[analytics] task "${t.task.taskname}" has tag="${tag}"`);
      if (!countsByTag.has(tag)) {
        countsByTag.set(tag, new Array(days).fill(0));
        countsSummary.set(tag, { total: 0, onTime: 0, late: 0 });
      }
      const idx = dayIndex.get(completionDateYMD)!;
      countsByTag.get(tag)![idx] += 1;
      //console.log(`[analytics] task "${t.task.taskname}" completed on ${completionDateYMD} with tag="${tag}" (onTime=${onTime}), CountsbyTag now:`, countsByTag.get(tag));

      const summary = countsSummary.get(tag)!;
      summary.total += 1;
      if (onTime) summary.onTime += 1; else summary.late += 1;
    }
  }

  // for completion-rate, we should consider tasks that were completed in window OR created in window?
  // here we compute rate = onTime / total for completed tasks in window (makes sense to user)
  const series: SeriesEntry[] = [];
  for (const [tag, arr] of countsByTag) {
    //console.log(`[analytics] tag=${tag} has daily counts:`, arr);
    series.push({ tag:tag, data: arr });
  }
  // sort tags by total desc for nicer presentation
  series.sort((a, b) => {
    const sumA = a.data.reduce((s, v) => s + v, 0);
    const sumB = b.data.reduce((s, v) => s + v, 0);
    return sumB - sumA;
  });
  //console.log(`[analytics] computed analytics, series for ${series} tags.`);  
  // build completion-rate-by-tag
  const labelsRate: string[] = [];
  const valuesRate: number[] = [];
  const countsObj: Record<string, { total: number; onTime: number; late: number }> = {};
  // iterate countsSummary sorted same way as series
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
  // Also include any tags that had zero daily counts but maybe exist elsewhere?
  for (const [tag, summary] of countsSummary) {
    if (!seen.has(tag)) {
      labelsRate.push(tag);
      valuesRate.push(summary.total > 0 ? summary.onTime / summary.total : 0);
      countsObj[tag] = { ...summary };
    }
  }

  const completedPerDay = {
    labels,
    series
  };

  const completionRateByTag = {
    labels: labelsRate,
    values: valuesRate,
    counts: countsObj
  };

  cache = {
    timestamp: Date.now(),
    days,
    completedPerDay,
    completionRateByTag
  };

  return { completedPerDay, completionRateByTag };
}



export default router;
