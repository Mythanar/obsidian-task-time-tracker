// export/adapters/CsvAdapter.ts
// Fase 3 — Exportacion CSV (primer adapter).
// Responsabilidad: convertir filas de exportacion ya resueltas a texto
// CSV valido (sin conocer nada de TimeEntry, TaskIdentifier ni del vault).

export interface ExportRow {
	date: string;
	startTime: string;
	endTime: string;
	duration: string;
	taskName: string;
	sourceNote: string;
	taskId: string;
}

const HEADERS = ["Fecha", "Hora inicio", "Hora fin", "Duración", "Tarea", "Nota de origen", "tt-id"];

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
			toCsvLine([row.date, row.startTime, row.endTime, row.duration, row.taskName, row.sourceNote, row.taskId]),
		),
	];
	return lines.join("\r\n") + "\r\n";
}
