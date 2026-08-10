// ui/StatusBarWidget.ts
// Fase 1 — MVP de tracking local.
// Responsabilidad: mostrar en el status bar de Obsidian la tarea activa
// y el tiempo transcurrido (addStatusBarItem de la API publica).
// Fase 5 UX (punto 3 del backlog): siempre muestra contenido, tambien en
// reposo; recorta el nombre de la tarea; el clic abre el panel de
// Historial (mismo destino en ambos estados).

import { Plugin } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { t } from "../i18n";
import { TimeEntry } from "../types";

// Corte a 40 caracteres con "..." al final para indicar que sigue; no
// hace falta tooltip con el nombre completo (decision explicita).
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
