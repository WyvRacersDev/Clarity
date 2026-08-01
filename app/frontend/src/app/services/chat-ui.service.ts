import { Injectable, signal } from '@angular/core';
import { ChatTarget, ProjectType } from './chat.service';

/**
 * ChatUiService — shell-level UI state for the slide-in chat panel.
 *
 * The panel is mounted ONCE in the layout, but anything in the app (the topbar
 * button, a project screen, the Messages page) needs to open it and point it at
 * a conversation. Rather than couple those callers to the panel component, they
 * drive this small signal store (SRP): the panel just reflects it.
 *
 * `projectChannel` is published by the project screen while a project is open,
 * so the panel can offer that project's channel as a conversation without having
 * to re-resolve the project itself.
 */
export interface ProjectChannelRef {
  projectName: string;
  projectType: ProjectType;
  label: string;
}

@Injectable({ providedIn: 'root' })
export class ChatUiService {
  /** Whether the slide-in panel is visible. */
  readonly isOpen = signal(false);
  /** The conversation the panel is currently showing (null → show the switcher). */
  readonly activeTarget = signal<ChatTarget | null>(null);
  /** The project channel available in the current context (set by the project screen). */
  readonly projectChannel = signal<ProjectChannelRef | null>(null);

  /** Open the panel on a project channel. */
  openProject(projectName: string, projectType: ProjectType): void {
    this.activeTarget.set({ scope: 'project', projectName, projectType });
    this.isOpen.set(true);
  }

  /** Open the panel on a 1:1 DM with `partner`. */
  openDm(partner: string): void {
    this.activeTarget.set({ scope: 'dm', to: partner });
    this.isOpen.set(true);
  }

  /** Open the panel without forcing a conversation (shows the switcher/last one). */
  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    this.isOpen.set(!this.isOpen());
  }

  /** Point the panel at a conversation (used by the switcher / conversation list). */
  setTarget(target: ChatTarget | null): void {
    this.activeTarget.set(target);
  }

  /** The project screen publishes/clears its channel as it mounts/unmounts. */
  setProjectChannel(ref: ProjectChannelRef | null): void {
    this.projectChannel.set(ref);
  }
}
