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
	// Fase 8 — Proyecto/Cliente asignado a la tarea (mismo origen que
	// CsvAdapter.ts#ExportRow), cadena vacia si no tiene ninguno asignado.
	// Siempre presentes en la fila; buildTogglCsv() decide si se escriben
	// segun el ajuste "Incluir Proyecto y Cliente".
	projectName: string;
	clientName: string;
}

const BASE_HEADERS = ["Email", "Description", "Start date", "Start time", "Duration"];
// Nombres exactos que espera el importador de Toggl (case-sensitive), ver
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

// includeProjectClient conmuta ambas columnas a la vez, nunca una sola —
// mismo ajuste que Settings > Toggl > "Incluir Proyecto y Cliente" (ver
// ExportManager.ts). Desactivado: comportamiento identico al anterior, 5
// columnas.
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
