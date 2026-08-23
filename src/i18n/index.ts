// i18n/index.ts
// Fase 6 — internacionalizacion. Ingles por defecto, espanol solo si
// Obsidian esta configurado en espanol. Deteccion vinculada a moment
// (export publico y documentado del paquete "obsidian", no un hack sobre
// localStorage ni sobre el DOM interno): Obsidian sincroniza el locale
// global de moment con el idioma de la interfaz. Se resuelve una sola vez,
// a nivel de modulo, porque cambiar el idioma de Obsidian ya le exige al
// usuario reiniciar la app — no hace falta escuchar cambios en caliente.
import { moment } from "obsidian";
import { en, TranslationKey } from "./en";
import { es } from "./es";

export type { TranslationKey };

export type Locale = "en" | "es";

export function detectLocale(): Locale {
	const locale = moment.locale();
	return typeof locale === "string" && locale.toLowerCase().startsWith("es") ? "es" : "en";
}

const dictionary: Record<TranslationKey, string> = detectLocale() === "es" ? es : en;

// Unico uso real hoy: recovery.body ({taskText}/{datetime}) y
// notice.exportSuccess ({filePath}). Sustitucion simple, sin plurales
// avanzados ni formato ICU: no hace falta mas para dos claves.
function interpolate(text: string, params: Record<string, string>): string {
	return Object.entries(params).reduce((acc, [key, value]) => acc.split(`{${key}}`).join(value), text);
}

export function t(key: TranslationKey, params?: Record<string, string>): string {
	const text = dictionary[key];
	return params ? interpolate(text, params) : text;
}
