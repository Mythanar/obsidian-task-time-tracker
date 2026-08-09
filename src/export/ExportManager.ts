// export/ExportManager.ts
// Fase 3 — Exportacion CSV generica. Fase 4 — Exportacion CSV para Toggl.
// Responsabilidad: orquestar la exportacion — filtrar sesiones cerradas
// por rango de fechas (segun la fecha de inicio, sin dividir sesiones que
// cruzan medianoche), resolver cada tarea por su tt-id:: y escribir el
// CSV resultante dentro del vault. Unico punto que toca el vault para
// exportar; nunca se llama desde el hot path de start/stop.
//
// La idempotencia vía externalId no aplica a ningun adapter de este
// archivo: cada exportacion genera un archivo nuevo, sin comprobar
// duplicados contra exportaciones anteriores (ver docs/DECISIONES.md).
// Ningun adapter llama a una API externa — Fase 4 se redefinio para
// generar archivos compatibles con el importador nativo de cada
// plataforma en vez de hacer push contra su API.

import { App } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { parseCheckboxLine, TaskIdentifier } from "../core/TaskIdentifier";
import { TimeEntry, TogglSettings } from "../types";
import { buildCsv, ExportRow } from "./adapters/CsvAdapter";
import { buildTogglCsv, formatTogglDate, formatTogglTime, TogglExportRow } from "./adapters/TogglCsvAdapter";

const EXPORTS_FOLDER = "task-tracker-exports";

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function formatDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(ms: number): string {
	const d = new Date(ms);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type ClosedTimeEntry = TimeEntry & { end: number };

export class ExportManager {
	constructor(
		private app: App,
		private taskIdentifier: TaskIdentifier,
	) {}

	// Exporta a un CSV nuevo las sesiones cerradas cuya fecha de inicio
	// cae entre fromMs y toMs (inclusive). Devuelve la ruta del archivo
	// creado dentro del vault.
	async exportToCsv(entries: TimeEntry[], fromMs: number, toMs: number): Promise<string> {
		const inRange = this.getEntriesInRange(entries, fromMs, toMs);

		const rows: ExportRow[] = [];
		for (const entry of inRange) {
			rows.push({
				date: formatDate(entry.start),
				startTime: formatTime(entry.start),
				endTime: formatTime(entry.end),
				duration: formatDuration(entry.end - entry.start),
				taskName: await this.resolveTaskName(entry),
				// La nota de origen es el snapshot inmutable de la sesion
				// (donde estaba la tarea cuando se inicio el tracking), no la
				// ubicacion actual del tt-id:: — esa puede haber cambiado
				// desde entonces y no debe reescribir el historico.
				sourceNote: entry.filePath,
				taskId: entry.taskId,
			});
		}
		rows.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

		return this.writeCsvFile(buildCsv(rows), "task-tracker-export");
	}

	// Exporta a un CSV nuevo, con las columnas que espera el importador de
	// Toggl (Email, Description, Start date, Start time, Duration), las
	// sesiones cerradas cuya fecha de inicio cae entre fromMs y toMs
	// (inclusive). Fecha y hora se formatean segun los ajustes de Toggl.
	async exportToTogglCsv(
		entries: TimeEntry[],
		fromMs: number,
		toMs: number,
		togglSettings: TogglSettings,
	): Promise<string> {
		const inRange = this.getEntriesInRange(entries, fromMs, toMs);

		const rows: TogglExportRow[] = [];
		for (const entry of inRange) {
			rows.push({
				email: togglSettings.email,
				description: await this.resolveTaskName(entry),
				startDate: formatTogglDate(entry.start, togglSettings.dateFormat),
				startTime: formatTogglTime(entry.start, togglSettings.timeFormat),
				duration: formatDuration(entry.end - entry.start),
			});
		}
		rows.sort((a, b) => (a.startDate + a.startTime).localeCompare(b.startDate + b.startTime));

		return this.writeCsvFile(buildTogglCsv(rows), "toggl-export");
	}

	private getEntriesInRange(entries: TimeEntry[], fromMs: number, toMs: number): ClosedTimeEntry[] {
		return entries.filter(
			(entry): entry is ClosedTimeEntry => entry.end !== null && entry.start >= fromMs && entry.start <= toMs,
		);
	}

	// Nombre de tarea a exportar: la descripcion actual de la linea (via
	// tt-id::) si todavia existe en el vault, o el snapshot tomado al
	// iniciar la sesion si la linea ya no existe.
	private async resolveTaskName(entry: TimeEntry): Promise<string> {
		const resolved = await this.taskIdentifier.resolve(entry.taskId);
		return resolved ? (parseCheckboxLine(resolved.lineText) ?? resolved.lineText) : entry.taskText;
	}

	private async writeCsvFile(csv: string, filePrefix: string): Promise<string> {
		if (!this.app.vault.getFolderByPath(EXPORTS_FOLDER)) {
			await this.app.vault.createFolder(EXPORTS_FOLDER);
		}

		const now = new Date();
		const fileName = `${filePrefix}_${formatDate(now.getTime())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;
		const filePath = `${EXPORTS_FOLDER}/${fileName}`;
		await this.app.vault.create(filePath, csv);
		return filePath;
	}
}
