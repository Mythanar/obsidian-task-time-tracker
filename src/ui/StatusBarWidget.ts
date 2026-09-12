// ui/StatusBarWidget.ts
// Responsibility: show the active task and elapsed time in Obsidian's
// status bar (addStatusBarItem from the public API). Always shows
// content, even at rest; truncates the task name; clicking opens the
// Historial panel (same destination in both states).

import { Plugin } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { t } from "../i18n";
import { TimeEntry } from "../types";

// Cut at 40 characters with "..." at the end to signal it continues; no
// tooltip with the full name needed (an explicit choice).
const MAX_TASK_TEXT_LENGTH = 40;

export class StatusBarWidget {
	private el: HTMLElement;

	constructor(
		plugin: Plugin,
		private getActiveEntry: () => TimeEntry | null,
		onClick: () => void,
	) {
		this.el = plugin.addStatusBarItem();
		this.el.addClass("task-time-tracker-statusbar");
		plugin.registerDomEvent(this.el, "click", onClick);
		plugin.registerInterval(window.setInterval(() => this.refresh(), 1000));
		this.refresh();
	}

	refresh(): void {
		const entry = this.getActiveEntry();
		if (!entry) {
			this.el.setText(`⏱ ${t("statusbar.idle")}`);
			return;
		}
		const isTruncated = entry.taskText.length > MAX_TASK_TEXT_LENGTH;
		const taskText = entry.taskText.slice(0, MAX_TASK_TEXT_LENGTH) + (isTruncated ? "..." : "");
		this.el.setText(`⏱ ${taskText} — ${formatDuration(Date.now() - entry.start)}`);
	}
}
