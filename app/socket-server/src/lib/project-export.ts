/**
 * Pure project → Markdown exporter for N10.
 *
 * Takes the `SerializedProject` shape produced by `loadProject` (owner/name/type
 * + grids of screen_elements) and renders a readable Markdown document. No I/O —
 * unit-testable in isolation; the route loads the project and sets headers.
 *
 * The JSON export needs no builder (the serialized project IS the payload); this
 * module only handles the Markdown rendering (and the browser print view reuses
 * the same structure client-side).
 */

/** Loosely-typed serialized project (mirrors project.repository SerializedProject). */
export interface ExportProject {
  owner_name: string;
  name: string;
  projectType: string;
  lastModified: string;
  grid: Array<{ name: string; Screen_elements: any[] }>;
}

function priorityLabel(priority: number): string {
  if (priority <= 1) return "High";
  if (priority === 2) return "Medium";
  return "Low";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 16).replace("T", " ");
}

function renderTodo(el: any, lines: string[]): void {
  const tasks: any[] = Array.isArray(el.scheduled_tasks) ? el.scheduled_tasks : [];
  if (tasks.length === 0) {
    lines.push("_No tasks._", "");
    return;
  }
  for (const t of tasks) {
    const box = t.is_done ? "[x]" : "[ ]";
    const bits: string[] = [];
    if (t.time) bits.push(`due ${formatDate(t.time)}`);
    if (typeof t.priority === "number") bits.push(priorityLabel(t.priority));
    if (t.status && t.status !== "todo") bits.push(String(t.status).replace("_", " "));
    if (t.repeat && t.repeat !== "none") bits.push(`repeats ${t.repeat}`);
    const meta = bits.length ? `  _(${bits.join(" · ")})_` : "";
    lines.push(`- ${box} ${t.taskname ?? "Untitled task"}${meta}`);
  }
  lines.push("");
}

/** Render one screen element to Markdown lines. */
function renderElement(el: any, lines: string[]): void {
  const type = el.type ?? "Element";
  const name = el.name ?? "Untitled";
  lines.push(`### ${name}  \`${type}\``, "");

  switch (type) {
    case "ToDoLst":
      renderTodo(el, lines);
      break;
    case "Text_document":
      lines.push((el.Text_field ?? "").toString().trim() || "_Empty document._", "");
      break;
    case "Image":
      lines.push(el.imagepath ? `![${name}](${el.imagepath})` : "_No image._", "");
      break;
    case "Video":
      lines.push(el.VideoPath ? `[Video: ${name}](${el.VideoPath})` : "_No video._", "");
      break;
    default:
      lines.push("");
  }
}

/** Render a full project to a Markdown string. */
export function projectToMarkdown(project: ExportProject): string {
  const lines: string[] = [];
  lines.push(`# ${project.name}`, "");
  lines.push(
    `_Owner: ${project.owner_name} · ${project.projectType} · Last modified: ${formatDate(
      project.lastModified
    )}_`,
    ""
  );

  const grids = Array.isArray(project.grid) ? project.grid : [];
  if (grids.length === 0) {
    lines.push("_This project has no grids yet._", "");
  }

  for (const grid of grids) {
    lines.push(`## ${grid.name ?? "Grid"}`, "");
    const elements = Array.isArray(grid.Screen_elements) ? grid.Screen_elements : [];
    if (elements.length === 0) {
      lines.push("_No elements._", "");
      continue;
    }
    for (const el of elements) renderElement(el, lines);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
