/**
 * Shared task-priority helpers.
 *
 * The `1 → High / 2 → Medium / 3 → Low` mapping (and its accent colour) was
 * copy-pasted across the tasks and dashboard components. Centralising it removes
 * the drift risk. NOTE: badge *class* mapping is deliberately NOT here — the
 * tasks screen uses component-scoped "album" hues while the dashboard uses the
 * global `badge-*` palette; unifying those is a visual/design decision.
 */

export type Priority = 1 | 2 | 3 | number;

/** Human label for a priority level. */
export function priorityLabel(priority: Priority): string {
  if (priority === 1) return 'High';
  if (priority === 2) return 'Medium';
  return 'Low';
}

/** CSS custom-property reference for a priority's accent colour (no hard-coded hex). */
export function priorityColorVar(priority: Priority): string {
  if (priority === 1) return 'var(--danger)';
  if (priority === 2) return 'var(--accent-blue)';
  return 'var(--accent-teal)';
}
