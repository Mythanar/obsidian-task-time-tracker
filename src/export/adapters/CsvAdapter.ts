// export/adapters/CsvAdapter.ts
// Fase 3 — Exportacion CSV (primer adapter).
// Responsabilidad: convertir filas de exportacion ya resueltas a texto
// CSV valido (sin conocer nada de TimeEntry, TaskIdentifier ni del vault).

import { t } from "../../i18n";

export interface ExportRow {
	date: string;
	startTime: string;
	endTime: string;
	duration: string;
	taskName: string;
	// Fase 8 — Proyecto/Cliente asignado a la tarea (ver ProjectManager),
	// cadena vacia si no tiene ninguno asignado: nunca bloquea la
	// exportacion. clientName vacio tambien cuando el proyecto no tiene
	// cliente, aunque si tenga nombre.
	projectName: string;
	clientName: string;
	sourceNote: string;
	taskId: string;
}

// Traducidas segun el idioma de Obsidian (decision revisada, agosto
// 2026): a diferencia del CSV de Toggl, este CSV no lo lee un
// importador externo con nombres de columna fijos — es de proposito
// general, abrir en cualquier hoja de calculo, asi que tiene sentido que
// hable el idioma de quien lo genera. "tt-id" queda fuera de la
// traduccion (literal, no via t()): es un identificador tecnico, no
// texto de interfaz.
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
