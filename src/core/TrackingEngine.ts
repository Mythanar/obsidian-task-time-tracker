// core/TrackingEngine.ts
// Fase 1 — MVP de tracking local.
// Responsabilidad: start/stop del timer activo, persistencia de TimeEntry[]
// via saveData/loadData. Sin dependencia de red.

import { PluginState, TimeEntry } from "../types";

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class TrackingEngine {
	constructor(
		private state: PluginState,
		private persist: (state: PluginState) => Promise<void>,
	) {}

	getActiveEntry(): TimeEntry | null {
		return this.state.entries.find((entry) => entry.end === null) ?? null;
	}

	getEntries(): TimeEntry[] {
		return this.state.entries;
	}

	// Suma de todas las sesiones ya cerradas de una tarea (por su tt-id).
	// Fase 5 UX — control inline: es la base sobre la que se muestra el
	// badge de tiempo acumulado (y, si la tarea esta activa, se le suma el
	// tiempo transcurrido de la sesion en curso aparte, en la UI).
	getAccumulatedMs(taskId: string): number {
		return this.state.entries
			.filter((entry) => entry.taskId === taskId && entry.end !== null)
			.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
	}

	// Un solo timer activo a la vez: si ya hay una sesion corriendo sobre
	// otra tarea, se cierra automaticamente (sin confirmacion) antes de
	// arrancar la nueva. Si la sesion activa es la misma tarea (mismo
	// tt-id), no hay nada que hacer: se ignora la accion sin tocar nada.
	// El vinculo con la tarea es el tt-id; taskText y filePath son
	// snapshots inmutables de esta sesion, no se usan para el vinculo.
	async start(taskId: string, taskText: string, filePath: string): Promise<"started" | "already-active"> {
		const active = this.getActiveEntry();
		if (active && active.taskId === taskId) {
			return "already-active";
		}

		if (active) {
			active.end = Date.now();
		}

		const entry: TimeEntry = {
			id: generateId(),
			taskId,
			taskText,
			filePath,
			start: Date.now(),
			end: null,
		};
		this.state.entries.push(entry);
		await this.persist(this.state);
		return "started";
	}

	async stop(): Promise<TimeEntry | null> {
		const active = this.getActiveEntry();
		if (!active) return null;
		active.end = Date.now();
		await this.persist(this.state);
		return active;
	}
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
}
