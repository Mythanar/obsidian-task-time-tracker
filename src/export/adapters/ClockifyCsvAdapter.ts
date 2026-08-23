// export/adapters/ClockifyCsvAdapter.ts
// Fase 9 — Exportacion CSV para el importador de Timesheets de Clockify.
// Responsabilidad: convertir filas de exportacion ya resueltas a texto CSV
// con las columnas que espera ese importador. No llama a la API de
// Clockify en ningun momento.
//
// A diferencia de Toggl, ningun formato de fecha/hora/duracion depende de
// un ajuste de Settings — son fijos, confirmados con pruebas reales (ver
// docs/Vault/Tareas/Clockify.md): Clockify pregunta el formato de fecha en
// el propio flujo de import (no hace falta adivinarlo aqui, solo generar
// uno fijo y decirselo al usuario en el modal), su importador de
// Timesheets no ofrece alternancia 12h/24h (siempre 24h, mismo criterio
// que el fix ya aplicado en TogglCsvAdapter.ts), y acepta la duracion en
// formato HH:mm sin depender de la config de duracion del workspace.

import { formatDuration } from "../../core/TrackingEngine";

export interface ClockifyExportRow {
	email: string;
	description: string;
	startDate: string;
	startTime: string;
	duration: string;
	// Fase 9 — Proyecto/Cliente asignado a la tarea (mismo origen que
	// CsvAdapter.ts#ExportRow y TogglCsvAdapter.ts#TogglExportRow), cadena
	// vacia si no tiene ninguno asignado. Rectificado el 22 de agosto de
	// 2026 (ver docs/Vault/Tareas/Clockify.md): Project NO es obligatorio
	// para el importador de CSV de Clockify (el hallazgo original venia del
	// formulario manual "Add time", no del importador) — se comporta igual
	// que Client, columna opt-in, ver buildClockifyCsv().
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

// HH:mm, sin segundos (a diferencia de formatDuration(), pensado para una
// sesion individual en el Historial) — se reutiliza su mismo calculo por
// truncamiento en vez de reimplementarlo, solo se descarta la parte de
// segundos del resultado.
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

// includeProject e includeClient conmutan cada columna por separado,
// independientes entre si (ver ClockifyExportRow arriba y
// docs/Vault/Tareas/Clockify.md): ambas son opt-in, ninguna obligatoria
// para el importador de CSV de Clockify. Orden fijo cuando ambas estan
// activas: Project antes que Client.
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
