// export/adapters/TogglCsvAdapter.ts
// Fase 4 — Exportacion CSV para el importador nativo de Toggl.
// Responsabilidad: convertir filas de exportacion ya resueltas a texto
// CSV con las columnas exactas que espera el importador de Toggl. No
// llama a la API de Toggl en ningun momento.
// Fix urgente (pre-release) — Start date y Start time salen SIEMPRE en el
// formato fijo que exige el importador de Toggl (YYYY-MM-DD y HH:MM:SS en
// 24h), sin leer ningun ajuste de Settings: el importador real no admite
// otro formato, asi que dejo de ser "configurable" y paso a ser un
// requisito fijo del adapter. Ver
// https://support.toggl.com/en-us/article/toggl-track-csv-import-guide-yx49tl/#ITE

export interface TogglExportRow {
	email: string;
	description: string;
	startDate: string;
	startTime: string;
	duration: string;
}

const HEADERS = ["Email", "Description", "Start date", "Start time", "Duration"];

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

export function buildTogglCsv(rows: TogglExportRow[]): string {
	const lines = [
		toCsvLine(HEADERS),
		...rows.map((row) => toCsvLine([row.email, row.description, row.startDate, row.startTime, row.duration])),
	];
	return lines.join("\r\n") + "\r\n";
}
