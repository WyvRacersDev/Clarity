import { ZodType, ZodError } from 'zod';

/**
 * Runtime validation boundary for untrusted Socket.IO payloads.
 *
 * Front-end constraint (Execution Protocol / rule 2): user- and network-sourced
 * data must be validated at runtime, never trusted via TypeScript types alone.
 * Everything arriving over the socket originates off this client (the server or
 * another collaborator), so it is untrusted and passes through here first.
 *
 * Deliberately NON-throwing: a malformed payload is dropped and logged, not
 * allowed to crash the canvas. Callers treat `ok: false` as "ignore this event",
 * which preserves the app's error-boundary posture instead of turning one bad
 * broadcast into a hard failure.
 */
export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ZodError };

const isDev = (): boolean => {
  // Avoid a hard dependency on Angular's isDevMode here so this helper stays
  // framework-agnostic and SSR-safe. Warnings are informational only.
  try {
    return typeof ngDevMode !== 'undefined' ? !!ngDevMode : true;
  } catch {
    return true;
  }
};

/**
 * Validate `data` against `schema`. On failure, logs a concise warning tagged
 * with `context` (the event name) and returns `{ ok: false }`.
 */
export function validate<T>(
  schema: ZodType<T>,
  data: unknown,
  context: string
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  if (isDev()) {
    const summary = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    console.warn(`[validate:${context}] dropped invalid payload — ${summary}`, data);
  }
  return { ok: false, error: result.error };
}

// `ngDevMode` is injected by the Angular compiler; declare it so this file
// type-checks without pulling in framework symbols.
declare const ngDevMode: unknown;
