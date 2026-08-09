// ui/StatusBarWidget.ts
// Fase 1 — MVP de tracking local.
// Responsabilidad: mostrar en el status bar de Obsidian la tarea activa
// y el tiempo transcurrido (addStatusBarItem de la API publica).

import { Plugin } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { TimeEntry } from "../types";

export class StatusBarWidget {
	private el: HTMLElement;

	constructor(
		plugin: Plugin,
		private getActiveEntry: () => TimeEntry | null,
	) {
		this.el = plugin.addStatusBarItem();
		plugin.registerInterval(window.setInterval(() => this.refresh(), 1000));
		this.refresh();
	}

	refresh(): void {
		const entry = this.getActiveEntry();
		if (!entry) {
			this.el.setText("");
			return;
		}
		this.el.setText(`⏱ ${entry.taskText} — ${formatDuration(Date.now() - entry.start)}`);
	}
}
