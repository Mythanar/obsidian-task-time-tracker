// export/adapters/ClockifyCsvAdapter.ts
// Responsibility: convert already-resolved export rows to CSV text with
// the columns that importer expects. Never calls the Clockify API.
//
// Unlike Toggl, no date/time/duration format depends on a Settings
// value — they're fixed, confirmed with real tests: Clockify asks for
// the date format during the import flow itself (no need to guess it
// here, just generate a fixed one and tell the user in the modal), its
// Timesheets importer doesn't offer 12h/24h alternation (always 24h,
// same criterion as the fix already applied in TogglCsvAdapter.ts), and
// it accepts duration in HH:mm format without depending on the
// workspace's duration config.

import { formatDuration } from "../../core/TrackingEngine";

export interface ClockifyExportRow {
	email: string;
	description: string;
	startDate: string;
	startTime: string;
	duration: string;
	// Project/Client assigned to the task (same source as
	// CsvAdapter.ts#ExportRow and TogglCsvAdapter.ts#TogglExportRow),
	// empty string if none is assigned. Project is NOT actually required
	// by Clockify's CSV importer (see docs/DECISIONS.md) — it behaves
	// just like Client, an opt-in column, see buildClockifyCsv().
	projectName: string;
	clientName: string;
}

const BASE_HEADERS = ["Email", "Description", "Start date", "Start time", "Duration"];
const PROJECT_HEADER = "Project";
const CLIENT_HEADER = "Client";

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

export function formatClockifyDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatClockifyTime(ms: number): string {
	const d = new Date(ms);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// HH:mm, no seconds (unlike formatDuration(), meant for an individual
// session in the Historial) — its same calculation is reused by
// truncation instead of reimplementing it, only the seconds part of the
// result is discarded.
export function formatClockifyDuration(ms: number): string {
	return formatDuration(ms).slice(0, 5);
}

function escapeCsvField(value: string): string {
	if (/[",\r\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function toCsvLine(fields: string[]): string {
	return fields.map(escapeCsvField).join(",");
}

// includeProject and includeClient toggle each column separately,
// independent of each other (see ClockifyExportRow above and
// docs/DECISIONS.md): both are opt-in, neither required by Clockify's
// CSV importer. Fixed order when both are on: Project before Client.
export function buildClockifyCsv(rows: ClockifyExportRow[], includeProject: boolean, includeClient: boolean): string {
	const headers = [...BASE_HEADERS];
	if (includeProject) headers.push(PROJECT_HEADER);
	if (includeClient) headers.push(CLIENT_HEADER);

	const lines = [
		toCsvLine(headers),
		...rows.map((row) => {
			const fields = [row.email, row.description, row.startDate, row.startTime, row.duration];
			if (includeProject) fields.push(row.projectName);
			if (includeClient) fields.push(row.clientName);
			return toCsvLine(fields);
		}),
	];
	return lines.join("\r\n") + "\r\n";
}
