import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  ChangeDetectorRef,
  PLATFORM_ID,
  Inject,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Subscription } from 'rxjs';
import { CollabService } from '../../../../services/collab.service';

/**
 * B3 — Collaborative rich-text editor for a `Text_document` element.
 *
 * A focused overlay hosting a Quill editor bound to a Yjs document via
 * `y-quill`'s QuillBinding. The Y.Doc is synced with the authoritative server
 * doc over the collab room (`ydoc:sync` on open, then live `ydoc:update`s), and
 * remote carets are rendered via `quill-cursors` driven by Yjs awareness
 * (`ydoc:awareness`). The CRDT merges concurrent edits with no last-write-wins
 * clobbering.
 *
 * Everything Yjs/Quill is loaded via dynamic import inside `ngAfterViewInit`,
 * browser-only, so the component is SSR-safe. On teardown the local element's
 * `Text_field` (plain mirror) + `ydoc` (base64) are updated so a following
 * whole-project save round-trips the collaborative state.
 */
@Component({
  selector: 'app-text-doc-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './text-doc-editor.component.html',
  styleUrls: ['./text-doc-editor.component.css'],
})
export class TextDocEditorComponent implements AfterViewInit, OnDestroy {
  /** The Text_document element (must carry a stable `id` for collab). */
  @Input() element: any;
  @Input() projectName = '';
  @Input() projectType: 'local' | 'hosted' = 'local';
  /** Local user's display name (for the remote-cursor label). */
  @Input() username = 'Anonymous';

  @Output() closed = new EventEmitter<void>();

  @ViewChild('editor', { static: true }) editorRef!: ElementRef<HTMLDivElement>;

  private isBrowser: boolean;
  private ready = false;

  // Yjs / Quill handles (typed loosely — modules are dynamically imported).
  private Y: any;
  private awarenessNs: any;
  private doc: any;
  private ytext: any;
  private quill: any;
  private binding: any;
  private awareness: any;
  private docUpdateHandler: ((update: Uint8Array, origin: any) => void) | null = null;
  private awarenessUpdateHandler: ((changes: any, origin: any) => void) | null = null;

  private subs: Subscription[] = [];

  /** Number of participants currently editing (from awareness states). */
  peerCount = 1;
  /** True until the initial server sync resolves. */
  syncing = true;

  constructor(
    private collab: CollabService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  private get elementId(): string | undefined {
    return this.element?.id;
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowser) return;
    try {
      await this.setup();
    } catch (err) {
      console.error('[TextDocEditor] setup failed:', err);
      this.syncing = false;
      this.cdr.detectChanges();
    }
  }

  private async setup(): Promise<void> {
    // Dynamic (browser-only) imports keep Quill/Yjs out of the SSR bundle.
    const [Y, quillMod, cursorsMod, yQuillMod, awarenessNs] = await Promise.all([
      import('yjs'),
      import('quill'),
      import('quill-cursors'),
      import('y-quill'),
      import('y-protocols/awareness'),
    ]);
    this.Y = Y;
    this.awarenessNs = awarenessNs;
    const Quill: any = (quillMod as any).default ?? quillMod;
    const QuillCursors: any = (cursorsMod as any).default ?? cursorsMod;
    const { QuillBinding } = yQuillMod as any;
    const { Awareness } = awarenessNs as any;

    Quill.register('modules/cursors', QuillCursors);

    this.doc = new Y.Doc();
    this.ytext = this.doc.getText('content'); // must match server TEXT_KEY

    this.quill = new Quill(this.editorRef.nativeElement, {
      theme: 'snow',
      placeholder: 'Start writing… others can edit this with you in real time.',
      modules: {
        cursors: true,
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block', 'link'],
          ['clean'],
        ],
        // Yjs owns undo/redo history; keep Quill's per-user only to avoid conflicts.
        history: { userOnly: true },
      },
    });

    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalStateField('user', {
      name: this.username,
      color: this.colorFor(this.username),
    });

    this.binding = new QuillBinding(this.ytext, this.quill, this.awareness);

    // --- Emit local doc/awareness changes to peers ---------------------------
    this.docUpdateHandler = (update: Uint8Array, origin: any) => {
      // 'remote'/'sync' origins came FROM the network — don't echo them back.
      if (origin === 'remote' || origin === 'sync') return;
      this.collab.emitYdocUpdate(this.elementId, this.toB64(update));
      this.mirrorToElement();
    };
    this.doc.on('update', this.docUpdateHandler);

    this.awarenessUpdateHandler = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: any
    ) => {
      if (origin === 'remote') {
        // Only refresh the participant count for inbound awareness.
        this.refreshPeerCount();
        return;
      }
      const changed = added.concat(updated, removed);
      const update = this.awarenessNs.encodeAwarenessUpdate(this.awareness, changed);
      this.collab.emitYdocAwareness(this.elementId, this.toB64(update));
      this.refreshPeerCount();
    };
    this.awareness.on('update', this.awarenessUpdateHandler);

    // --- Apply remote doc/awareness updates ----------------------------------
    this.subs.push(
      this.collab.onYdocUpdated().subscribe(({ elementId, update }) => {
        if (elementId !== this.elementId || !update) return;
        this.Y.applyUpdate(this.doc, this.fromB64(update), 'remote');
      }),
      this.collab.onYdocAwareness().subscribe(({ elementId, update }) => {
        if (elementId !== this.elementId || !update) return;
        this.awarenessNs.applyAwarenessUpdate(this.awareness, this.fromB64(update), 'remote');
      })
    );

    // --- Initial sync with the authoritative server doc ----------------------
    const sv = this.toB64(this.Y.encodeStateVector(this.doc));
    const res = this.elementId ? await this.collab.syncYdoc(this.elementId, sv) : null;
    if (res?.update) {
      // Apply the server's state (origin 'remote' → not re-emitted).
      this.Y.applyUpdate(this.doc, this.fromB64(res.update), 'remote');
      // Send back anything the server was missing (offline/local-only edits).
      const diff = this.Y.encodeStateAsUpdate(this.doc, this.fromB64(res.stateVector));
      if (diff.length > 2) this.collab.emitYdocUpdate(this.elementId, this.toB64(diff));
    }

    // Migrate a legacy plain-text doc (Text_field, no ydoc yet) into the CRDT.
    if (this.ytext.length === 0 && typeof this.element?.Text_field === 'string' && this.element.Text_field.length) {
      this.ytext.insert(0, this.element.Text_field); // local edit → emits + persists
    }

    this.ready = true;
    this.syncing = false;
    this.refreshPeerCount();
    this.cdr.detectChanges();
  }

  /** Refresh the "N editing" count from awareness (deduped by client). */
  private refreshPeerCount(): void {
    const count = this.awareness ? this.awareness.getStates().size : 1;
    this.peerCount = Math.max(1, count);
    this.cdr.detectChanges();
  }

  /** Mirror the CRDT text + encoded state onto the local element model. */
  private mirrorToElement(): void {
    if (!this.element || !this.ready && !this.doc) return;
    try {
      this.element.Text_field = this.ytext.toString();
      this.element.ydoc = this.toB64(this.Y.encodeStateAsUpdate(this.doc));
    } catch {
      /* best-effort */
    }
  }

  close(): void {
    this.closed.emit();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.subs = [];
    if (!this.isBrowser) return;
    try {
      // Persist the final state onto the element (for whole-project save).
      if (this.ready) this.mirrorToElement();
      // Tell peers to drop our caret, then tear down.
      if (this.awareness) {
        this.awarenessNs.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
        const update = this.awarenessNs.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
        this.collab.emitYdocAwareness(this.elementId, this.toB64(update));
        if (this.awarenessUpdateHandler) this.awareness.off('update', this.awarenessUpdateHandler);
        this.awareness.destroy();
      }
      if (this.docUpdateHandler && this.doc) this.doc.off('update', this.docUpdateHandler);
      if (this.binding) this.binding.destroy();
      if (this.doc) this.doc.destroy();
    } catch (err) {
      console.warn('[TextDocEditor] teardown warning:', err);
    }
  }

  // --- base64 <-> Uint8Array (browser) ---------------------------------------

  private toB64(bytes: Uint8Array): string {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
    }
    return btoa(bin);
  }

  private fromB64(b64: string): Uint8Array {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  /** Stable per-user accent color (matches the presence hashing style in B2). */
  private colorFor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 55%)`;
  }
}
