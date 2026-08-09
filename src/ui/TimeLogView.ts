// ui/TimeLogView.ts
// Fase 1 — MVP de tracking local (panel de historial basico).
// Fase 2 — cada entrada se resuelve por su tt-id::; si la linea ya no
// existe en ninguna nota, se muestra como "Tarea no encontrada" sin
// descartar el historico.
// Responsabilidad: ItemView de panel lateral con lista cronologica simple
// de sesiones guardadas, sin agrupaciones ni filtros (llegan en Fase 5).
// Su unico proposito en esta fase es verificar que el dato se guarda bien.

import { ItemView, WorkspaceLeaf } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { parseCheckboxLine, ResolvedTask, TaskIdentifier } from "../core/TaskIdentifier";
import { TimeEntry } from "../types";

export const TIME_LOG_VIEW_TYPE = "task-time-tracker-log-view";

export class TimeLogView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private getEntries: () => TimeEntry[],
		private taskIdentifier: TaskIdentifier,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TIME_LOG_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Time tracker log";
	}

	getIcon(): string {
		return "clock";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	refresh(): void {
		void this.render();
	}

	private async resolveTaskIds(entries: TimeEntry[]): Promise<Map<string, ResolvedTask | null>> {
		const uniqueIds = [...new Set(entries.map((entry) => entry.taskId))];
		const resolutions = new Map<string, ResolvedTask | null>();
		for (const taskId of uniqueIds) {
			resolutions.set(taskId, await this.taskIdentifier.resolve(taskId));
		}
		return resolutions;
	}

	private taskLabel(taskId: string, resolutions: Map<string, ResolvedTask | null>): string {
		const resolved = resolutions.get(taskId) ?? null;
		if (!resolved) return "Tarea no encontrada";
		return parseCheckboxLine(resolved.lineText) ?? resolved.lineText;
	}

	private renderTotals(container: Element, entries: TimeEntry[], resolutions: Map<string, ResolvedTask | null>): void {
		const totalsByTaskId = new Map<string, { count: number; totalMs: number }>();
		for (const entry of entries) {
			const duration = (entry.end ?? Date.now()) - entry.start;
			const current = totalsByTaskId.get(entry.taskId) ?? { count: 0, totalMs: 0 };
			current.count += 1;
			current.totalMs += duration;
			totalsByTaskId.set(entry.taskId, current);
		}

		container.createEl("h5", { text: "Total acumulado por tarea" });
		const totalsList = container.createDiv({ cls: "task-time-tracker-log-list" });
		for (const [taskId, { count, totalMs }] of totalsByTaskId) {
			const row = totalsList.createDiv({ cls: "task-time-tracker-log-row" });
			row.createDiv({ text: this.taskLabel(taskId, resolutions), cls: "task-time-tracker-log-task" });

			const meta = row.createDiv({ cls: "task-time-tracker-log-meta" });
			meta.createSpan({ text: `${count} sesión${count === 1 ? "" : "es"}` });
			meta.createSpan({ text: formatDuration(totalMs), cls: "task-time-tracker-totals-duration" });
			meta.createSpan({ text: taskId, cls: "task-time-tracker-log-taskid" });
		}
	}

	private renderList(container: Element, entries: TimeEntry[], resolutions: Map<string, ResolvedTask | null>): void {
		container.createEl("h5", { text: "Sesiones" });
		const list = container.createDiv({ cls: "task-time-tracker-log-list" });
		for (const entry of entries) {
			const resolved = resolutions.get(entry.taskId) ?? null;
			const row = list.createDiv({ cls: "task-time-tracker-log-row" });

			if (resolved) {
				row.createDiv({
					text: parseCheckboxLine(resolved.lineText) ?? resolved.lineText,
					cls: "task-time-tracker-log-task",
				});
			} else {
				row.createDiv({ text: "Tarea no encontrada", cls: "task-time-tracker-log-task task-time-tracker-log-task-missing" });
				row.createDiv({ text: entry.taskText, cls: "task-time-tracker-log-task-snapshot" });
			}

			const meta = row.createDiv({ cls: "task-time-tracker-log-meta" });
			const startDate = new Date(entry.start);
			meta.createSpan({ text: startDate.toLocaleDateString() });
			meta.createSpan({
				text: `${startDate.toLocaleTimeString()} → ${
					entry.end ? new Date(entry.end).toLocaleTimeString() : "en curso"
				}`,
			});
			meta.createSpan({
				text: entry.end ? formatDuration(entry.end - entry.start) : "—",
			});
			meta.createSpan({ text: entry.taskId, cls: "task-time-tracker-log-taskid" });
		}
	}

	private async render(): Promise<void> {
		const container = this.containerEl.children[1];
		if (!container) return;

		const entries = [...this.getEntries()].sort((a, b) => b.start - a.start);
		const resolutions = await this.resolveTaskIds(entries);

		container.empty();
		container.createEl("h4", { text: "Historial de tracking" });

		if (entries.length === 0) {
			container.createEl("p", { text: "Todavía no hay sesiones registradas." });
			return;
		}

		this.renderTotals(container, entries, resolutions);
		this.renderList(container, entries, resolutions);
	}
}
