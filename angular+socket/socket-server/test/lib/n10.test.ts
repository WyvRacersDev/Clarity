/**
 * N10 pure-logic tests — the ICS calendar builder, the Markdown project
 * exporter, and the webhook payload shaper. No DB / no socket (test/lib pattern).
 */
import { describe, it, expect } from "vitest";
import { buildIcsCalendar, escapeText, formatUtc, type IcsTask } from "@src/lib/ics.js";
import { projectToMarkdown, type ExportProject } from "@src/lib/project-export.js";
import { buildWebhookPayload, type WebhookNotification } from "@services/integrations.service.js";

const NOW = new Date("2026-01-02T03:04:05Z");

describe("ics builder (N10)", () => {
  const tasks: IcsTask[] = [
    { id: "a1", taskname: "Ship, now; really", due: "2026-02-01T09:00:00Z", is_done: false, priority: 1, project_name: "Launch" },
    { id: "a2", taskname: "Done thing", due: "2026-02-02T10:00:00Z", is_done: true, priority: 3, project_name: "Launch" },
    { id: "a3", taskname: "No due date", due: null, is_done: false, priority: 2, project_name: "Launch" },
  ];

  it("formats a UTC timestamp as YYYYMMDDTHHMMSSZ", () => {
    expect(formatUtc(NOW)).toBe("20260102T030405Z");
  });

  it("escapes commas, semicolons, and backslashes", () => {
    expect(escapeText("Ship, now; really\\done")).toBe("Ship\\, now\\; really\\\\done");
  });

  it("wraps VEVENTs in a VCALENDAR and skips undated tasks", () => {
    const ics = buildIcsCalendar(tasks, { now: NOW });
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    // 2 dated tasks → 2 VEVENTs (the undated one is skipped).
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("UID:task-a1@clarity");
    expect(ics).toContain("DTSTART:20260201T090000Z");
    expect(ics).toContain("DTSTAMP:20260102T030405Z");
    // Uses CRLF line endings.
    expect(ics).toContain("\r\n");
    // The summary text is escaped.
    expect(ics).toContain("Ship\\, now\\; really");
  });

  it("marks a completed task's event CANCELLED with a ✓ summary", () => {
    const ics = buildIcsCalendar([tasks[1]!], { now: NOW });
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SUMMARY:✓ Done thing");
  });
});

describe("project markdown export (N10)", () => {
  const project: ExportProject = {
    owner_name: "alice",
    name: "Launch Plan",
    projectType: "local",
    lastModified: "2026-01-02T03:04:05Z",
    grid: [
      {
        name: "Main",
        Screen_elements: [
          {
            type: "ToDoLst",
            name: "Tasks",
            scheduled_tasks: [
              { taskname: "Write copy", is_done: false, priority: 1, time: "2026-02-01T09:00:00Z", status: "in_progress", repeat: "none" },
              { taskname: "Publish", is_done: true, priority: 2, time: null, status: "done", repeat: "weekly" },
            ],
          },
          { type: "Text_document", name: "Notes", Text_field: "Hello world" },
        ],
      },
    ],
  };

  it("renders headings, task checkboxes, and metadata", () => {
    const md = projectToMarkdown(project);
    expect(md).toContain("# Launch Plan");
    expect(md).toContain("Owner: alice");
    expect(md).toContain("## Main");
    expect(md).toContain("### Tasks");
    expect(md).toContain("- [ ] Write copy");
    expect(md).toContain("High");
    expect(md).toContain("- [x] Publish");
    expect(md).toContain("repeats weekly");
    expect(md).toContain("Hello world");
  });

  it("handles an empty project gracefully", () => {
    const md = projectToMarkdown({ owner_name: "bob", name: "Empty", projectType: "local", lastModified: "", grid: [] });
    expect(md).toContain("# Empty");
    expect(md).toContain("no grids");
  });
});

describe("webhook payload (N10)", () => {
  const n: WebhookNotification = {
    type: "mention",
    title: "alice mentioned you",
    body: "look at this",
    actor: "alice",
    projectName: "Launch",
    link: "/dashboard/projects",
    created_at: NOW.toISOString(),
  };

  it("shapes a Slack payload as { text }", () => {
    const payload = buildWebhookPayload("slack", n);
    expect(payload).toEqual({ text: "*alice mentioned you*\nlook at this" });
  });

  it("shapes a generic payload with the structured fields", () => {
    const payload = buildWebhookPayload("generic", n) as any;
    expect(payload.source).toBe("clarity");
    expect(payload.type).toBe("mention");
    expect(payload.title).toBe("alice mentioned you");
    expect(payload.link).toBe("/dashboard/projects");
  });
});
