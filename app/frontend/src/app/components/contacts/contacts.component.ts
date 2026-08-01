import {
  Component,
  OnInit,
  OnDestroy,
  PLATFORM_ID,
  inject,
  signal,
  computed,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DataService } from '../../services/data.service';
import { User, contact } from '../../../../../shared_models/models/user.model';

/**
 * Screen 7 — Contacts (ported from frontend B). Contacts live on the User
 * object, so we read `user.contacts[]` (and `settings.allow_invite`, which gates
 * import) via A's DataService. Import runs `DataService.importGoogleContacts()`,
 * which imports over the socket, reloads the user from the backend and pushes
 * the merged contacts through `currentUser$`. Status surfaces via an inline
 * banner (A has no toast service). Presentational contact-row and the import
 * button from B are folded inline into this standalone component.
 */
@Component({
  selector: 'app-contacts',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './contacts.component.html',
  styleUrl: './contacts.component.css',
})
export class ContactsComponent implements OnInit, OnDestroy {
  private readonly dataService = inject(DataService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly contacts = signal<contact[]>([]);
  protected readonly allowInvite = signal(true);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly importing = signal(false);
  protected readonly search = signal('');

  // Inline status banner (replaces B's ToastService).
  protected readonly banner = signal<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  private userSub: Subscription | null = null;

  protected readonly filtered = computed<contact[]>(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.contacts();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.contact_detail?.toLowerCase().includes(q),
    );
  });

  protected readonly isEmpty = computed(
    () => !this.loading() && !this.error() && this.contacts().length === 0,
  );
  protected readonly noMatches = computed(
    () =>
      !this.loading() &&
      !this.error() &&
      this.contacts().length > 0 &&
      this.filtered().length === 0,
  );

  ngOnInit(): void {
    if (!this.isBrowser) return;

    // React to user changes (import reloads the user and re-emits currentUser$).
    this.userSub = this.dataService.currentUser$.subscribe((user) => {
      this.applyUser(user);
      this.loading.set(false);
    });

    // If the user is already loaded, seed immediately.
    const current = this.dataService.getCurrentUser();
    if (current) {
      this.applyUser(current);
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  private applyUser(user: User | null): void {
    this.error.set(null);
    this.contacts.set(user?.contacts ?? []);
    this.allowInvite.set(user?.settings?.allow_invite ?? true);
  }

  reload(): void {
    this.applyUser(this.dataService.getCurrentUser());
    this.loading.set(false);
  }

  async startImport(): Promise<void> {
    if (this.importing()) return;
    if (!this.allowInvite()) {
      this.banner.set({
        kind: 'info',
        text: "Enable 'Allow Invites' in Settings to import contacts.",
      });
      return;
    }
    this.importing.set(true);
    this.banner.set(null);
    try {
      const res = await this.dataService.importGoogleContacts();
      if (res.success) {
        const added = res.newContacts ?? 0;
        this.banner.set({
          kind: 'success',
          text:
            added > 0
              ? `Imported ${added} new contact${added === 1 ? '' : 's'}.`
              : 'Contacts are up to date.',
        });
        // currentUser$ subscription refreshes the list; also seed synchronously.
        this.applyUser(this.dataService.getCurrentUser());
      } else {
        this.banner.set({ kind: 'error', text: res.message ?? 'Contact import failed.' });
      }
    } catch (e: any) {
      this.banner.set({ kind: 'error', text: `Error: ${e?.message ?? 'Contact import failed.'}` });
    } finally {
      this.importing.set(false);
    }
  }

  // --- contact-row helpers (folded in from B's ContactRow) --------------------

  detailOf(c: contact): string {
    return c.contact_detail?.trim() ?? '';
  }

  isEmail(c: contact): boolean {
    return /@/.test(this.detailOf(c));
  }

  initialsOf(c: contact): string {
    const name = c.name?.trim();
    if (!name) return '?';
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  trackContact(_index: number, c: contact): string {
    return c.contact_detail || c.name;
  }
}
