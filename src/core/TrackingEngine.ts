// core/TrackingEngine.ts
// Responsibility: start/stop of the active timer. No network dependency.
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

	// Sum of all already-closed sessions of a task (by its tt-id). This is
	// the base the accumulated-time badge is built on for the inline
	// control (and, if the task is active, the UI adds the elapsed time
	// of the current session on top, separately).
	getAccumulatedMs(taskId: string): number {
		return this.store
			.getState()
			.entries
			.filter((entry) => entry.taskId === taskId && entry.end !== null)
			.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
	}

	// Only one active timer at a time: if a session is already running on
	// another task, it's closed automatically (no confirmation) before
	// starting the new one. If the active session is the same task (same
	// tt-id), there's nothing to do: the action is ignored untouched. The
	// link to the task is the tt-id; taskText and filePath are immutable
	// snapshots of this session, not used for the link.
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

// Compact format for AGGREGATE totals (several sessions summed: a task
// card's header, or the summary in a full-task delete confirmation) —
// never for an individual session or the edit form, which stay on
// formatDuration() (HH:MM:SS, fixed width, seconds relevant at that
// scale). Toggl criterion: always accumulates in hours, no upper limit
// and no "days" unit (127h 49m is an expected value, not a bug). No
// leading zeros and no zero units except the smallest one shown. No
// seconds unless the total is under a minute (rare, for freshly created
// tasks): always showing them would make the total's width change every
// second while a live tracking session is adding up, and at an
// aggregate total's scale they don't add useful precision. "h"/"m"/"s"
// don't go through t() — same criterion already applied to HH:MM:SS,
// "→" and "+1": universal format/symbol, not content to translate (see
// docs/glosario-traduccion-i18n.md, section 7.2).
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
