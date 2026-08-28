// ui/sessionEdit.ts
// Fase 5 UX / rediseno "Editar tarea desde el Historial" — funciones puras
// de fecha/hora y el renderer de solo lectura de una sesion, compartidos
// entre TimeLogView.ts (tarjeta, detalle expandido de solo lectura) y
// EditTaskModal.ts (unica via de edicion de sesiones desde el rediseno).

import { Platform } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { t } from "../i18n";
import { TimeEntry } from "../types";

// Estado transitorio de edicion de una sesion dentro del modal: solo una a
// la vez, nunca se persiste. Un clic fuera de la fila no la descarta (solo
// Guardar/Cancelar/Eliminar lo hacen). Los cuatro campos (fecha inicio,
// hora inicio, fecha fin, hora fin) son campos de texto simples
// ("YYYY-MM-DD"/"HH:MM:SS"), incluida la fecha de fin: deja de inferirse
// por comparacion de horas y pasa a ser un dato mas que el usuario
// controla directamente. Si se cancela, la sesion original queda intacta.
// {campo}Evaluated: si ese campo ya paso por blur o alcanzo longitud
// completa al menos una vez desde el ultimo cambio (ver bindDraftField en
// EditTaskModal.ts) — mientras no sea asi, un formato invalido no se
// muestra todavia (el usuario sigue escribiendo).
export interface EditDraft {
	entryId: string;
	startDate: string;
	startDateEvaluated: boolean;
	startTime: string;
	startTimeEvaluated: boolean;
	endDate: string;
	endDateEvaluated: boolean;
	endTime: string;
	endTimeEvaluated: boolean;
	error: string | null;
	confirmingDelete: boolean;
}

export interface ParsedTime {
	hours: number;
	minutes: number;
	seconds: number;
}

const TIME_INPUT_REGEX = /^([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
const DATE_INPUT_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

export function formatDateInput(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "HH:MM:SS" en hora local (ver EditDraft).
export function formatHMS(ms: number): string {
	const d = new Date(ms);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function parseTimeInput(value: string): ParsedTime | null {
	const match = value.trim().match(TIME_INPUT_REGEX);
	if (!match) return null;
	return { hours: Number(match[1]), minutes: Number(match[2]), seconds: Number(match[3]) };
}

// Devuelve la medianoche local de esa fecha, o null si el campo no tiene
// el formato "YYYY-MM-DD" que produce <input type="date">, o si el dia no
// existe en ese mes/año (ej. "2026-08-88", o "2026-02-29" en un año no
// bisiesto). El constructor de Date por si solo NO rechaza esto: hace
// overflow silencioso hacia meses/años siguientes (new Date(2026, 7, 88)
// da octubre), asi que se reconstruye la fecha y se compara componente a
// componente contra lo tecleado — si Date la reinterpreto, alguno no
// coincide y se rechaza. Bug critico QA 0.0.29: sin este chequeo, un dia
// fuera de rango se guardaba como una fecha distinta sin ningun aviso.
export function parseDateInput(value: string): number | null {
	const match = value.match(DATE_INPUT_REGEX);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = new Date(year, month, day);
	if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
	return date.getTime();
}

function combineDateAndTime(dateAtMidnightMs: number, time: ParsedTime): number {
	const d = new Date(dateAtMidnightMs);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), time.hours, time.minutes, time.seconds, 0).getTime();
}

// Numero de dias naturales de diferencia entre la fecha (parte de fecha,
// sin hora) de startMs y la de endMs — para el badge "+N" de la fila de
// sesion estatica. Ambas fechas se normalizan con Date.UTC(y, m, d) — no
// con resta directa de timestamps ni con dias * 86400000 en hora local —
// para que el resultado sea siempre un entero exacto incluso si el rango
// cruza un cambio de horario de verano/invierno entre esas dos fechas.
function getDaySpan(startMs: number, endMs: number): number {
	const s = new Date(startMs);
	const e = new Date(endMs);
	const startUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
	const endUtc = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
	return Math.round((endUtc - startUtc) / 86400000);
}

// Dos rangos [start, end) se solapan si cada uno empieza antes de que el
// otro termine. Una sesion activa (sin end) se trata como si terminara
// "ahora" a estos efectos.
export function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
	return startA < endB && startB < endA;
}

export type DraftResolution = { ok: true; start: number; end: number } | { ok: false; error: string };

// Resuelve el rango final a partir de los cuatro campos del borrador, tal
// cual los dejo el usuario (segundos incluidos, sin forzar nada). Fecha de
// fin y fecha de inicio son independientes: quien decide si la sesion
// cruza medianoche (o varios dias) es la propia fecha de fin tecleada, no
// una inferencia por comparacion de horas.
export function resolveDraftTimestamps(draft: EditDraft): DraftResolution {
	const startDateMs = parseDateInput(draft.startDate);
	const endDateMs = parseDateInput(draft.endDate);
	const start = parseTimeInput(draft.startTime);
	const end = parseTimeInput(draft.endTime);
	if (startDateMs === null || endDateMs === null || !start || !end) {
		return { ok: false, error: t("log.errorFormat") };
	}

	return {
		ok: true,
		start: combineDateAndTime(startDateMs, start),
		end: combineDateAndTime(endDateMs, end),
	};
}

// Para la punta que no se ha tocado (su texto sigue siendo el mismo con el
// que se abrio la edicion, tanto fecha como hora), se usa el timestamp
// real de la sesion en vez del reconstruido por resolveDraftTimestamps() —
// evita cualquier diferencia de precision entre ambos calculos.
export function effectiveRange(draft: EditDraft, entry: TimeEntry, resolved: { start: number; end: number }) {
	const startUnchanged = draft.startDate === formatDateInput(entry.start) && draft.startTime === formatHMS(entry.start);
	const endUnchanged =
		draft.endDate === formatDateInput(entry.end as number) && draft.endTime === formatHMS(entry.end as number);
	return {
		start: startUnchanged ? entry.start : resolved.start,
		end: endUnchanged ? (entry.end as number) : resolved.end,
	};
}

// Fecha + hora inicio + hora fin (con indicador "+N" si abarca mas de un
// dia natural) + duracion. Solo lectura: unico renderer de una fila de
// sesion, usado tanto por la tarjeta (detalle expandido) como por el modal
// de Editar (filas no seleccionadas para edicion). onLiveTick, si se pasa,
// se invoca con el elemento del contador de una sesion en curso para que
// el llamador la registre en su propio mecanismo de tick por segundo (la
// tarjeta ya tiene uno via el bus de tracking; el modal, al ser una
// superficie transitoria, no necesita uno propio y deja el valor estatico
// tal cual estaba al abrir).
export function renderSessionInfo(
	container: Element,
	entry: TimeEntry,
	onLiveTick?: (counterEl: HTMLElement, completedMs: number, start: number) => void,
): void {
	const info = container.createDiv({ cls: "task-time-tracker-log-session-info" });

	// Columna izquierda (fecha + rango horario): agrupada aparte de la
	// duracion para que esta ultima quede siempre alineada a la derecha,
	// con un min-width fijo en la fecha para que actue como columna
	// consistente entre filas.
	const left = info.createDiv({ cls: "task-time-tracker-log-session-left" });
	const startDate = new Date(entry.start);
	left.createSpan({ text: startDate.toLocaleDateString(), cls: "task-time-tracker-log-session-date" });

	const rangeSpan = left.createSpan({ cls: "task-time-tracker-log-session-range" });
	rangeSpan.createSpan({ text: startDate.toLocaleTimeString() });
	rangeSpan.createSpan({ text: " → ", cls: "task-time-tracker-log-session-arrow" });
	if (entry.end !== null) {
		rangeSpan.createSpan({ text: new Date(entry.end).toLocaleTimeString() });
		const daySpan = getDaySpan(entry.start, entry.end);
		if (daySpan > 0) {
			rangeSpan.createSpan({ text: ` +${daySpan}`, cls: "task-time-tracker-log-nextday-badge" });
			// Fecha de fin de apoyo, solo junto al badge: en sesiones largas
			// (+N grande) evita que el usuario tenga que calcular a mano la
			// fecha final a partir de la de inicio. No se renderiza en
			// mobile: el ancho de pantalla ahi es mas critico.
			if (!Platform.isMobile) {
				rangeSpan.createSpan({
					text: ` (${new Date(entry.end).toLocaleDateString()})`,
					cls: "task-time-tracker-log-nextday-date",
				});
			}
		}
	} else {
		rangeSpan.createSpan({ text: t("log.ongoing"), cls: "task-time-tracker-log-ongoing" });
	}

	if (entry.end !== null) {
		info.createSpan({
			text: formatDuration(entry.end - entry.start),
			cls: "task-time-tracker-log-session-duration",
		});
		return;
	}

	// Sesion en curso: mismo punto pulsante + contador que ya usan el badge
	// junto al checkbox y el boton de stop de la tarjeta activa, en vez de
	// un guion suelto.
	const live = info.createDiv({
		cls: "task-time-tracker-log-session-duration task-time-tracker-log-session-live",
	});
	live.createSpan({ cls: "task-time-tracker-inline-dot" });
	const counter = live.createSpan({ cls: "task-time-tracker-log-session-live-value" });
	counter.setText(formatDuration(Date.now() - entry.start));
	if (onLiveTick) onLiveTick(counter, 0, entry.start);
}
