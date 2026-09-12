// export/adapters/TogglCsvAdapter.ts
// Responsibility: convert already-resolved export rows to CSV text with
// the exact columns Toggl's importer expects. Never calls the Toggl API.
// Start date and Start time ALWAYS come out in the fixed format Toggl's
// importer requires (YYYY-MM-DD and 24h HH:MM:SS), without reading any
// Settings value (see docs/DECISIONS.md): the real importer doesn't
// accept any other format. See
// https://support.toggl.com/en-us/article/toggl-track-csv-import-guide-yx49tl/#ITE

export interface TogglExportRow {
	email: string;
	description: string;
	startDate: string;
	startTime: string;
	duration: string;
	// Project/Client assigned to the task (same source as
	// CsvAdapter.ts#ExportRow), empty string if none is assigned. Always
	// present on the row; buildTogglCsv() decides whether they get
	// written based on the "Include Project and Client" setting.
	projectName: string;
	clientName: string;
}

const BASE_HEADERS = ["Email", "Description", "Start date", "Start time", "Duration"];
// Exact names Toggl's importer expects (case-sensitive), see
// https://support.toggl.com/en-us/article/toggl-track-csv-import-guide-yx49tl/#ITE
const PROJECT_CLIENT_HEADERS = ["Project", "Client"];

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

export function formatTogglDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatTogglTime(ms: number): string {
	const d = new Date(ms);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

// includeProjectClient toggles both columns at once, never just one —
// same setting as Settings > Toggl > "Include Project and Client" (see
// ExportManager.ts). Off: identical behavior to before, 5 columns.
export function buildTogglCsv(rows: TogglExportRow[], includeProjectClient: boolean): string {
	const headers = includeProjectClient ? [...BASE_HEADERS, ...PROJECT_CLIENT_HEADERS] : BASE_HEADERS;
	const lines = [
		toCsvLine(headers),
		...rows.map((row) => {
			const fields = [row.email, row.description, row.startDate, row.startTime, row.duration];
			if (includeProjectClient) {
				fields.push(row.projectName, row.clientName);
			}
			return toCsvLine(fields);
		}),
	];
	return lines.join("\r\n") + "\r\n";
}
