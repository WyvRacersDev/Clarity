/**
 * Tiny UI-state helper (SRP): tracks which named modals / overlays / menus are
 * currently open, replacing a scatter of independent `showXModal` booleans with
 * one object. Generic over a string union of modal names, so every
 * open/close/isOpen call is checked at compile time — a typo becomes a type
 * error instead of a silently-dead boolean.
 *
 * Holds no framework state and touches no DOM; the owning (zoneless) component
 * still drives change detection exactly as before.
 */
export class ModalManager<T extends string = string> {
  private readonly openSet = new Set<T>();

  /** Open a modal (idempotent). */
  open(name: T): void { this.openSet.add(name); }

  /** Close a modal (idempotent). */
  close(name: T): void { this.openSet.delete(name); }

  /** Flip a modal; returns its new open state. */
  toggle(name: T): boolean {
    if (this.openSet.has(name)) { this.openSet.delete(name); return false; }
    this.openSet.add(name);
    return true;
  }

  /** Whether the named modal is currently open. */
  isOpen(name: T): boolean { return this.openSet.has(name); }

  /**
   * True if any of the given modals is open — or, when called with no
   * arguments, if any modal at all is open. Lets callers gate behaviour on a
   * specific subset (e.g. "a blocking modal is up") without re-listing booleans.
   */
  anyOpen(...names: T[]): boolean {
    if (names.length === 0) return this.openSet.size > 0;
    return names.some(n => this.openSet.has(n));
  }

  /** Close every open modal. */
  closeAll(): void { this.openSet.clear(); }
}
