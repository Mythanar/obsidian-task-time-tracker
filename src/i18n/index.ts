// i18n/index.ts
// English by default, Spanish only if Obsidian is configured in
// Spanish. Detection tied to moment (a public, documented export of the
// "obsidian" package, not a hack over localStorage or the internal DOM):
// Obsidian syncs moment's global locale with the interface language.
// Resolved once, at module level, because changing Obsidian's language
// already requires the user to restart the app — no need to listen for
// live changes.
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

// Only real use today: recovery.body ({taskText}/{datetime}) and
// notice.exportSuccess ({filePath}). Simple substitution, no advanced
// plurals or ICU format: not needed for just two keys.
function interpolate(text: string, params: Record<string, string>): string {
	return Object.entries(params).reduce((acc, [key, value]) => acc.split(`{${key}}`).join(value), text);
}

export function t(key: TranslationKey, params?: Record<string, string>): string {
	const text = dictionary[key];
	return params ? interpolate(text, params) : text;
}
