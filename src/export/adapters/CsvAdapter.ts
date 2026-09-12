// export/adapters/CsvAdapter.ts
// Responsibility: convert already-resolved export rows to valid CSV text
// (without knowing anything about TimeEntry, TaskIdentifier, or the vault).

import { t } from "../../i18n";

export interface ExportRow {
	date: string;
	startTime: string;
	endTime: string;
	duration: string;
	taskName: string;
	// Project/Client assigned to the task (see ProjectManager), empty
	// string if none is assigned: never blocks the export. clientName is
	// also empty when the project has no client, even if it has a name.
	projectName: string;
	clientName: string;
	sourceNote: string;
	taskId: string;
}

// Translated per Obsidian's language (see
// docs/glosario-traduccion-i18n.md): unlike the Toggl CSV, this one
// isn't read by an external importer with fixed column names — it's
// general-purpose, meant to be opened in any spreadsheet, so it makes
// sense for it to speak the generator's language. "tt-id" stays out of
// translation (literal, not via t()): it's a technical identifier, not
// interface text.
const HEADERS = [
	t("export.csv.headerDate"),
	t("export.csv.headerStartTime"),
	t("export.csv.headerEndTime"),
	t("export.csv.headerDuration"),
	t("export.csv.headerTask"),
	t("export.csv.headerProject"),
	t("export.csv.headerClient"),
	t("export.csv.headerSourceNote"),
	"tt-id",
];

function escapeCsvField(value: string): string {
	if (/[",\r\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function toCsvLine(fields: string[]): string {
	return fields.map(escapeCsvField).join(",");
}

export function buildCsv(rows: ExportRow[]): string {
	const lines = [
		toCsvLine(HEADERS),
		...rows.map((row) =>
			toCsvLine([
				row.date,
				row.startTime,
				row.endTime,
				row.duration,
				row.taskName,
				row.projectName,
				row.clientName,
				row.sourceNote,
				row.taskId,
			]),
		),
	];
	return lines.join("\r\n") + "\r\n";
}
