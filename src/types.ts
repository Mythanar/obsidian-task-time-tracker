// types.ts
// Modelo de datos compartido.
// Fase 2 — el vinculo tarea<->sesion es exclusivamente el identificador
// inline tt-id:: (ver core/TaskIdentifier.ts), nunca el texto ni la ruta.
// Fase 3 fix — taskText y filePath son snapshots inmutables tomados al
// iniciar la sesion; nunca se reescriben despues (ni siquiera al cerrar
// la sesion o al trackear la misma tarea desde otra nota).

export interface TimeEntry {
	id: string;
	taskId: string;
	taskText: string;
	filePath: string;
	start: number;
	end: number | null;
}

// Fase 4 — ajustes de Toggl, campos manuales (nunca se consultan via API).
export type TogglDateFormat = "ISO" | "DD-MM-YYYY" | "MM-DD-YYYY";
export type TogglTimeFormat = "24h" | "12h";

export interface TogglSettings {
	email: string;
	dateFormat: TogglDateFormat;
	timeFormat: TogglTimeFormat;
}

export interface PluginSettings {
	toggl: TogglSettings;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	toggl: {
		email: "",
		dateFormat: "ISO",
		timeFormat: "24h",
	},
};

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidEmail(email: string): boolean {
	return EMAIL_REGEX.test(email.trim());
}

export interface PluginState {
	entries: TimeEntry[];
	settings: PluginSettings;
}
