// export/adapters/TogglCsvAdapter.ts
// Fase 4 — Exportacion CSV para el importador nativo de Toggl.
// Responsabilidad: convertir filas de exportacion ya resueltas a texto
// CSV con las columnas exactas que espera el importador de Toggl, y
// formatear fecha/hora segun los ajustes de Toggl. No llama a la API de
// Toggl en ningun momento.

import { TogglDateFormat, TogglTimeFormat } from "../../types";

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

export function formatTogglDate(ms: number, format: TogglDateFormat): string {
	const d = new Date(ms);
	const year = d.getFullYear();
	const month = pad(d.getMonth() + 1);
	const day = pad(d.getDate());
	switch (format) {
		case "DD-MM-YYYY":
			return `${day}-${month}-${year}`;
		case "MM-DD-YYYY":
			return `${month}-${day}-${year}`;
		case "ISO":
			return `${year}-${month}-${day}`;
	}
}

export function formatTogglTime(ms: number, format: TogglTimeFormat): string {
	const d = new Date(ms);
	const minutes = pad(d.getMinutes());
	const seconds = pad(d.getSeconds());
	if (format === "12h") {
		const hours24 = d.getHours();
		const period = hours24 < 12 ? "AM" : "PM";
		const hours12 = hours24 % 12 || 12;
		return `${pad(hours12)}:${minutes}:${seconds} ${period}`;
	}
	return `${pad(d.getHours())}:${minutes}:${seconds}`;
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
