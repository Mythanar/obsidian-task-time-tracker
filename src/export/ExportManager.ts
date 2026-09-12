// export/ExportManager.ts
// Responsibility: orchestrate exporting — filter closed sessions by date
// range (by start date, without splitting sessions that cross midnight),
// resolve each task by its tt-id::, and write the resulting CSV inside
// the vault. The only place that touches the vault for exporting; never
// called from the start/stop hot path.
//
// Idempotence via externalId doesn't apply to any adapter in this file:
// each export generates a new file, without checking for duplicates
// against previous exports (see docs/DECISIONS.md). No adapter calls an
// external API — files compatible with each platform's native importer
// are generated instead of pushing to its API.

import { App } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { ProjectManager } from "../core/ProjectManager";
import { parseCheckboxLine, TaskIdentifier } from "../core/TaskIdentifier";
import { ClockifySettings, TimeEntry, TogglSettings } from "../types";
import { buildCsv, ExportRow } from "./adapters/CsvAdapter";
import { buildTogglCsv, formatTogglDate, formatTogglTime, TogglExportRow } from "./adapters/TogglCsvAdapter";
import {
	buildClockifyCsv,
	ClockifyExportRow,
	formatClockifyDate,
	formatClockifyDuration,
	formatClockifyTime,
} from "./adapters/ClockifyCsvAdapter";

// Fallback if the settings value ever arrived empty (shouldn't happen:
// DEFAULT_SETTINGS.exportsFolder already covers that case from
// main.ts#onload).
const FALLBACK_EXPORTS_FOLDER = "task-tracker-exports";

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
		private projectManager: ProjectManager,
	) {}

	// Exports to a new CSV the closed sessions whose start date falls
	// between fromMs and toMs (inclusive). Returns the created file's
	// path inside the vault. exportsFolder is the configurable Settings
	// value; changing it only affects the next export onward, never
	// moves files already generated in the previous folder.
	async exportToCsv(entries: TimeEntry[], fromMs: number, toMs: number, exportsFolder: string): Promise<string> {
		const inRange = this.getEntriesInRange(entries, fromMs, toMs);

		const rows: ExportRow[] = [];
		for (const entry of inRange) {
			// Live link by tt-id (see ProjectManager#getProjectForTask), not
			// a snapshot: if the task is reassigned after a session was
			// already exported, the next export reflects the current
			// assignment. Empty string (never blocks the export) if there's
			// no project, or if the project has no client.
			const project = this.projectManager.getProjectForTask(entry.taskId);
			rows.push({
				date: formatDate(entry.start),
				startTime: formatTime(entry.start),
				endTime: formatTime(entry.end),
				duration: formatDuration(entry.end - entry.start),
				taskName: await this.resolveTaskName(entry),
				projectName: project?.name ?? "",
				clientName: project?.client ?? "",
				// The source note is the session's immutable snapshot (where
				// the task was when tracking started), not the tt-id::'s
				// current location — that may have changed since then and
				// must not rewrite the history.
				sourceNote: entry.filePath,
				taskId: entry.taskId,
			});
		}
		rows.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

		return this.writeCsvFile(buildCsv(rows), "task-tracker-export", exportsFolder);
	}

	// Exports to a new CSV, with the columns Toggl's importer expects
	// (Email, Description, Start date, Start time, Duration), the closed
	// sessions whose start date falls between fromMs and toMs (inclusive).
	// Date and time always come out in the fixed format Toggl's importer
	// requires (YYYY-MM-DD, 24h HH:MM:SS) — not configurable, see
	// TogglCsvAdapter.ts. Same configurable exportsFolder as exportToCsv —
	// a single setting for both formats, no need for a separate one per
	// platform.
	async exportToTogglCsv(
		entries: TimeEntry[],
		fromMs: number,
		toMs: number,
		togglSettings: TogglSettings,
		exportsFolder: string,
	): Promise<string> {
		const inRange = this.getEntriesInRange(entries, fromMs, toMs);

		const rows: TogglExportRow[] = [];
		for (const entry of inRange) {
			// Same source as exportToCsv (see
			// ProjectManager#getProjectForTask): live link by tt-id, empty
			// string if no project is assigned or the project has no
			// client. Always resolved, even if the "Include Project and
			// Client" setting is off — it's buildTogglCsv() that decides
			// whether those columns get written.
			const project = this.projectManager.getProjectForTask(entry.taskId);
			rows.push({
				email: togglSettings.email,
				description: await this.resolveTaskName(entry),
				startDate: formatTogglDate(entry.start),
				startTime: formatTogglTime(entry.start),
				duration: formatDuration(entry.end - entry.start),
				projectName: project?.name ?? "",
				clientName: project?.client ?? "",
			});
		}
		rows.sort((a, b) => (a.startDate + a.startTime).localeCompare(b.startDate + b.startTime));

		return this.writeCsvFile(
			buildTogglCsv(rows, togglSettings.includeProjectClient),
			"toggl-export",
			exportsFolder,
		);
	}

	// Exports to a new CSV, with the columns Clockify's Timesheets
	// importer expects (Email, Description, Start date, Start time,
	// Duration always; Project and Client each only if its setting is
	// on), the closed sessions whose start date falls between fromMs and
	// toMs (inclusive). Date, time (24h) and duration (HH:mm) always come
	// out in a fixed format — not configurable, see
	// ClockifyCsvAdapter.ts. No column is actually required by Clockify's
	// importer (see docs/DECISIONS.md), so a session with no project
	// assigned never blocks the export. Same configurable exportsFolder
	// as the other two formats.
	async exportToClockifyCsv(
		entries: TimeEntry[],
		fromMs: number,
		toMs: number,
		clockifySettings: ClockifySettings,
		exportsFolder: string,
	): Promise<string> {
		const inRange = this.getEntriesInRange(entries, fromMs, toMs);

		const rows: ClockifyExportRow[] = [];
		for (const entry of inRange) {
			// Same source as exportToCsv/exportToTogglCsv (see
			// ProjectManager#getProjectForTask): live link by tt-id, empty
			// string if no project is assigned or the project has no
			// client. Always resolved, even if the "Include Client" setting
			// is off — it's buildClockifyCsv() that decides whether that
			// column gets written.
			const project = this.projectManager.getProjectForTask(entry.taskId);
			rows.push({
				email: clockifySettings.email,
				description: await this.resolveTaskName(entry),
				startDate: formatClockifyDate(entry.start),
				startTime: formatClockifyTime(entry.start),
				duration: formatClockifyDuration(entry.end - entry.start),
				projectName: project?.name ?? "",
				clientName: project?.client ?? "",
			});
		}
		rows.sort((a, b) => (a.startDate + a.startTime).localeCompare(b.startDate + b.startTime));

		return this.writeCsvFile(
			buildClockifyCsv(rows, clockifySettings.includeProject, clockifySettings.includeClient),
			"clockify-export",
			exportsFolder,
		);
	}

	private getEntriesInRange(entries: TimeEntry[], fromMs: number, toMs: number): ClosedTimeEntry[] {
		return entries.filter(
			(entry): entry is ClosedTimeEntry => entry.end !== null && entry.start >= fromMs && entry.start <= toMs,
		);
	}

	// Task name to export: the line's current description (via tt-id::)
	// if it still exists in the vault, or the snapshot taken when the
	// session started if the line no longer exists.
	private async resolveTaskName(entry: TimeEntry): Promise<string> {
		const resolved = await this.taskIdentifier.resolve(entry.taskId);
		return resolved ? (parseCheckboxLine(resolved.lineText) ?? resolved.lineText) : entry.taskText;
	}

	private async writeCsvFile(csv: string, filePrefix: string, exportsFolder: string): Promise<string> {
		const folder = exportsFolder.trim() || FALLBACK_EXPORTS_FOLDER;
		if (!this.app.vault.getFolderByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		const now = new Date();
		const fileName = `${filePrefix}_${formatDate(now.getTime())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;
		const filePath = `${folder}/${fileName}`;
		await this.app.vault.create(filePath, csv);
		return filePath;
	}
}
