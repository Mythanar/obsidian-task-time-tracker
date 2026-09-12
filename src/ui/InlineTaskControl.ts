// ui/InlineTaskControl.ts
// Tag-like badge next to a trackable task's checkbox, with a play/stop
// icon and the total accumulated time. Edit mode only (CodeMirror, see
// InlineTaskControlExtension.ts): this class knows nothing about CM6, it
// only draws the state and delegates the click to the callbacks the
// integration passes it.

import { Platform, setIcon } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { TimeEntry } from "../types";

export interface InlineTaskControlDeps {
	getActiveEntry: () => TimeEntry | null;
	getAccumulatedMs: (taskId: string) => number;
}

export interface InlineTaskControlHandlers {
	onStart: () => void;
	onStop: () => void;
}

// taskId and closed are taken as a fixed snapshot taken when the control
// mounts: the control only remounts when the line's text changes (see
// eq() in InlineTaskControlExtension.ts), so they stay valid for as long
// as the DOM lives.
export class InlineTaskControlView {
	readonly el: HTMLElement;
	private iconEl: HTMLElement;
	private dotEl: HTMLElement;
	private badgeEl: HTMLElement;

	constructor(
		private taskId: string | null,
		private closed: boolean,
		private deps: InlineTaskControlDeps,
		private handlers: InlineTaskControlHandlers,
	) {
		this.el = createSpan({ cls: "task-time-tracker-inline-control" });
		// The play icon (open task, no history, not active) is only
		// revealed by CSS on :hover over the line (see styles.css) — on
		// mobile there's no hover, so without this it would stay
		// invisible with no way to start tracking. Platform.isMobile
		// doesn't change live, it's fixed once when the widget mounts.
		this.el.toggleClass("is-mobile", Platform.isMobile);
		this.iconEl = this.el.createSpan({ cls: "task-time-tracker-inline-icon" });
		// Pulsing dot, only visible (via CSS, see .is-active in
		// styles.css) while this task is the one with active tracking.
		this.dotEl = this.el.createSpan({ cls: "task-time-tracker-inline-dot" });
		this.badgeEl = this.el.createSpan({ cls: "task-time-tracker-inline-badge" });

		// Keeps mousedown from moving the editor's cursor before our
		// click is processed (same trick Obsidian uses for its own
		// interactive checkboxes in Live Preview).
		this.el.addEventListener("mousedown", (evt) => evt.preventDefault());
		this.el.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			if (this.el.hasClass("is-static")) return;

			const active = this.deps.getActiveEntry();
			if (this.taskId && active?.taskId === this.taskId) {
				this.handlers.onStop();
			} else {
				this.handlers.onStart();
			}
		});

		this.refresh();
	}

	refresh(): void {
		const active = this.deps.getActiveEntry();
		const isActiveTask = !!this.taskId && active?.taskId === this.taskId;
		const accumulatedMs = this.taskId ? this.deps.getAccumulatedMs(this.taskId) : 0;
		const hasHistory = accumulatedMs > 0;

		this.el.toggleClass("is-active", isActiveTask);
		// With at least one saved session, the badge (icon + counter)
		// stays always visible instead of only on hover (see styles.css);
		// doesn't apply to is-static (closed), which is already always
		// visible on its own.
		this.el.toggleClass("has-history", hasHistory);

		if (isActiveTask && active) {
			this.el.toggleClass("is-static", false);
			this.el.toggleClass("is-hidden", false);
			this.iconEl.toggleClass("is-hidden", false);
			setIcon(this.iconEl, "square");
			this.badgeEl.toggleClass("is-hidden", false);
			this.badgeEl.setText(formatDuration(accumulatedMs + (Date.now() - active.start)));
			return;
		}

		if (this.closed) {
			this.el.toggleClass("is-static", hasHistory);
			this.el.toggleClass("is-hidden", !hasHistory);
			this.iconEl.toggleClass("is-hidden", !hasHistory);
			if (hasHistory) setIcon(this.iconEl, "check");
			this.badgeEl.toggleClass("is-hidden", !hasHistory);
			if (hasHistory) this.badgeEl.setText(formatDuration(accumulatedMs));
			return;
		}

		// Open task, not active: play icon always visible; the badge
		// with the counter only if it already has accumulated time from
		// previous sessions (in which case has-history keeps it visible
		// without needing hover).
		this.el.toggleClass("is-static", false);
		this.el.toggleClass("is-hidden", false);
		this.iconEl.toggleClass("is-hidden", false);
		setIcon(this.iconEl, "play");
		this.badgeEl.toggleClass("is-hidden", !hasHistory);
		if (hasHistory) this.badgeEl.setText(formatDuration(accumulatedMs));
	}
}
