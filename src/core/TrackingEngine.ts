// core/TrackingEngine.ts
// Fase 1 — MVP de tracking local.
// Responsabilidad: start/stop del timer activo. Sin dependencia de red.
//
// Persistence always goes through StateStore (read-before-write, see
// core/StateStore.ts): the engine never saves its own in-memory copy.

import { StateStore } from "./StateStore";
import { TimeEntry } from "../types";

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class TrackingEngine {
	constructor(private store: StateStore) {}

	getActiveEntry(): TimeEntry | null {
		return this.store.getState().entries.find((entry) => entry.end === null) ?? null;
	}

	getEntries(): TimeEntry[] {
		return this.store.getState().entries;
	}

	// Suma de todas las sesiones ya cerradas de una tarea (por su tt-id).
	// Fase 5 UX — control inline: es la base sobre la que se muestra el
	// badge de tiempo acumulado (y, si la tarea esta activa, se le suma el
	// tiempo transcurrido de la sesion en curso aparte, en la UI).
	getAccumulatedMs(taskId: string): number {
		return this.store
			.getState()
			.entries
			.filter((entry) => entry.taskId === taskId && entry.end !== null)
			.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
	}

	// Un solo timer activo a la vez: si ya hay una sesion corriendo sobre
	// otra tarea, se cierra automaticamente (sin confirmacion) antes de
	// arrancar la nueva. Si la sesion activa es la misma tarea (mismo
	// tt-id), no hay nada que hacer: se ignora la accion sin tocar nada.
	// El vinculo con la tarea es el tt-id; taskText y filePath son
	// snapshots inmutables de esta sesion, no se usan para el vinculo.
	//
	// The whole decision is taken INSIDE the mutation, on the state just
	// read from disk: if another device left a session open and Sync has
	// already delivered it here, it is visible and the one-active-timer
	// rule still holds. Closing someone else's open session never destroys
	// data (it gets an end, it is not removed), and a console warning is
	// logged if there was more than one.
	async start(taskId: string, taskText: string, filePath: string): Promise<"started" | "already-active"> {
		return this.store.apply((state) => {
			const open = state.entries.filter((entry) => entry.end === null);
			if (open.some((entry) => entry.taskId === taskId)) {
				return { result: "already-active" as const, changed: false };
			}

			const now = Date.now();
			if (open.length > 1) {
				console.warn(
					`Task Time Tracker: ${open.length} sesiones abiertas a la vez en data.json (posible tracking simultaneo en otro dispositivo). Se cierran todas al arrancar la nueva; no se descarta ninguna.`,
				);
			}
			for (const entry of open) {
				entry.end = now;
			}

			state.entries.push({
				id: generateId(),
				taskId,
				taskText,
				filePath,
				start: now,
				end: null,
			});
			return { result: "started" as const };
		});
	}

	// Closes the active session the user is looking at (the one in memory)
	// by looking it up by id in the on-disk state. Defensive cases: if that
	// session is not on disk it is reconstructed with its end instead of
	// losing the operation, and if other sessions stay open (from another
	// device) they are left untouched and warned about — no history is
	// invented and no foreign record is discarded.
	async stop(): Promise<TimeEntry | null> {
		const remembered = this.getActiveEntry();
		return this.store.apply((state) => {
			const now = Date.now();
			const open = state.entries.filter((entry) => entry.end === null);
			const target =
				(remembered ? open.find((entry) => entry.id === remembered.id) : undefined) ?? open[0] ?? null;

			if (!target) {
				if (!remembered) return { result: null, changed: false };
				console.warn(
					`Task Time Tracker: la sesion activa en memoria (${remembered.id}) no existe en data.json; se reconstruye cerrada para no perderla.`,
				);
				const restored: TimeEntry = { ...remembered, end: now };
				state.entries.push(restored);
				return { result: restored };
			}

			target.end = now;
			const stillOpen = open.filter((entry) => entry !== target).length;
			if (stillOpen > 0) {
				console.warn(
					`Task Time Tracker: quedan ${stillOpen} sesiones abiertas en data.json tras detener la actual (posible tracking en otro dispositivo). Se conservan tal cual.`,
				);
			}
			return { result: target };
		});
	}
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
}

// Formato compacto para totales AGREGADOS (varias sesiones sumadas: la
// cabecera de una tarjeta de tarea, o el resumen de la confirmacion de
// borrado de tarea completa) — nunca para una sesion individual ni para
// el formulario de edicion, que se quedan en formatDuration() (HH:MM:SS,
// ancho fijo, segundos relevantes a esa escala). Criterio Toggl: se
// acumula siempre en horas, sin limite superior y sin la unidad "dias"
// (127h 49m es un valor esperado, no un error). Sin ceros a la
// izquierda y sin unidades en cero salvo la mas pequeña que se muestre.
// Sin segundos salvo que el total sea menor a un minuto (caso raro con
// tareas recien creadas): mostrarlos siempre habria hecho que el ancho
// del total cambiara cada segundo mientras hay tracking activo sumando
// en vivo, y a la escala de un total agregado no aportan precision
// util. "h"/"m"/"s" no pasan por t() — mismo criterio ya aplicado a
// HH:MM:SS, "→" y "+1": formato/simbolo universal, no contenido a
// traducir (ver docs/glosario-traduccion-i18n.md, seccion 7.2).
export function formatDurationCompact(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);

	if (hours > 0) {
		return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	}
	if (minutes > 0) {
		return `${minutes}m`;
	}
	return `${totalSeconds}s`;
}
