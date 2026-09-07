// core/StateStore.ts
// Multi-device sync safety (Obsidian Sync).
//
// THE PROBLEM this module solves: the plugin used to load data.json once
// in onload() and, from then on, every operation saved the ENTIRE state
// it held in memory. With two active devices that loses data:
//
//   1. Device A creates new time entries.
//   2. Obsidian Sync delivers the updated data.json to device B's disk.
//   3. B still holds its older copy of the state in memory.
//   4. The user does anything on B (start/stop, edit, delete, a setting,
//      renaming a project).
//   5. B rewrites the whole blob from that stale memory.
//   6. A's entries are gone from the latest version of the file.
//
// THE RULE this module enforces: every state-changing operation re-reads
// data.json right before mutating, applies ONLY its own mutation to that
// freshly read state, saves, and only then adopts the persisted result as
// the in-memory state. An operation on one record can never erase
// unrelated records that exist on disk but not in memory.
//
// Two full snapshots are deliberately NOT merged (union by id or
// similar): that would resurrect records deleted on another device, since
// a record missing from memory can mean either "deleted" or "not yet
// delivered here", and a snapshot cannot tell the two apart. The concrete
// operation is what decides what changes.
//
// RACE THAT REMAINS UNSOLVED (accepted on purpose):
//
//   Device A reads the old state
//   Device B reads the old state
//   A writes its change
//   B writes its own before Sync has delivered A's
//
// Read-before-write cannot merge data that has not reached the machine
// yet. Solving that would require a data format with per-record history
// (or a file per session), out of scope for this change. What is
// guaranteed: once a synced version is on the local disk, no later local
// operation overwrites the unrelated records in that version.

import { DEFAULT_SETTINGS, PluginSettings, PluginState, Project, TimeEntry } from "../types";

// Injected disk access (in production, the Plugin's loadData/saveData).
// Injected instead of receiving the whole Plugin so the store can be
// tested without the Obsidian API.
export interface StateIO {
	load: () => Promise<unknown>;
	save: (state: PluginState) => Promise<void>;
}

// A mutation receives the state just read from disk and mutates it in
// place. `changed: false` means the operation was a validated no-op
// (duplicate project name, missing entry, task already active...) and
// that nothing needs to be written.
export type Mutation<T> = (state: PluginState) => { result: T; changed?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Defensive filter: a half-synced or hand-edited data.json must not take
// the plugin's load down. Anything that lacks the minimum shape of a
// TimeEntry is dropped instead of being propagated to the rest of the
// code.
function normalizeEntries(raw: unknown): TimeEntry[] {
	if (!Array.isArray(raw)) return [];
	const entries: TimeEntry[] = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		if (typeof item.id !== "string" || typeof item.taskId !== "string") continue;
		if (typeof item.start !== "number") continue;
		if (typeof item.end !== "number" && item.end !== null) continue;
		entries.push({
			id: item.id,
			taskId: item.taskId,
			taskText: typeof item.taskText === "string" ? item.taskText : "",
			filePath: typeof item.filePath === "string" ? item.filePath : "",
			start: item.start,
			end: item.end,
		});
	}
	return entries;
}

function normalizeProjects(raw: unknown): Project[] {
	if (!Array.isArray(raw)) return [];
	const projects: Project[] = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		if (typeof item.id !== "string" || typeof item.name !== "string") continue;
		projects.push({
			id: item.id,
			name: item.name,
			client: typeof item.client === "string" ? item.client : undefined,
		});
	}
	return projects;
}

function normalizeTaskProjects(raw: unknown): Record<string, string> {
	if (!isRecord(raw)) return {};
	const assignments: Record<string, string> = {};
	for (const [taskId, projectId] of Object.entries(raw)) {
		if (typeof projectId === "string") assignments[taskId] = projectId;
	}
	return assignments;
}

function normalizeSettings(raw: unknown): PluginSettings {
	const settings = isRecord(raw) ? raw : {};
	const toggl = isRecord(settings.toggl) ? settings.toggl : {};
	const clockify = isRecord(settings.clockify) ? settings.clockify : {};
	return {
		toggl: { ...DEFAULT_SETTINGS.toggl, ...toggl },
		clockify: { ...DEFAULT_SETTINGS.clockify, ...clockify },
		logViewLocation:
			settings.logViewLocation === "tab" || settings.logViewLocation === "sidebar"
				? settings.logViewLocation
				: DEFAULT_SETTINGS.logViewLocation,
		exportsFolder:
			typeof settings.exportsFolder === "string" ? settings.exportsFolder : DEFAULT_SETTINGS.exportsFolder,
		taskIdFormat:
			settings.taskIdFormat === "normal" || settings.taskIdFormat === "reduced" || settings.taskIdFormat === "hidden"
				? settings.taskIdFormat
				: DEFAULT_SETTINGS.taskIdFormat,
	};
}

// The single place where whatever loadData() returns (anything: null on a
// fresh install, a data.json from an older version, a half-written file)
// is converted into a complete, valid PluginState. Used ALWAYS after a
// read; the shape of the file is never assumed.
export function normalizeState(raw: unknown): PluginState {
	const source = isRecord(raw) ? raw : {};
	return {
		entries: normalizeEntries(source.entries),
		settings: normalizeSettings(source.settings),
		projects: normalizeProjects(source.projects),
		taskProjects: normalizeTaskProjects(source.taskProjects),
	};
}

export class StateStore {
	private state: PluginState = normalizeState(null);
	// Single-lane queue: two local operations in a row (two quick clicks)
	// cannot interleave their read/write and clobber each other.
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private io: StateIO) {}

	// The in-memory state. A reference to this object is never kept: the
	// store replaces it wholesale after every write, so every consumer
	// reads through this method on each use.
	getState(): PluginState {
		return this.state;
	}

	// Initial load (onload). Writes nothing.
	async init(): Promise<PluginState> {
		return this.reload();
	}

	// Re-read without writing, for onExternalSettingsChange(): another
	// device (or Sync) changed data.json and all that is needed is
	// refreshing memory and UI. Observing an external change never
	// justifies a save.
	async reload(): Promise<PluginState> {
		return this.enqueue(async () => {
			this.state = normalizeState(await this.io.load());
			return this.state;
		});
	}

	// The primitive: read the latest state from disk -> apply only this
	// operation -> save -> adopt the persisted result as in-memory state.
	async apply<T>(fn: Mutation<T>): Promise<T> {
		return this.enqueue(async () => {
			const latest = normalizeState(await this.io.load());
			const { result, changed = true } = fn(latest);
			if (changed) {
				await this.io.save(latest);
			}
			this.state = latest;
			return result;
		});
	}

	async addEntry(entry: TimeEntry): Promise<void> {
		await this.apply((state) => {
			if (state.entries.some((e) => e.id === entry.id)) return { result: undefined, changed: false };
			state.entries.push(entry);
			return { result: undefined };
		});
	}

	// Updates only the given fields of one session; the rest of the
	// history on disk is left untouched.
	async updateEntry(entryId: string, patch: Partial<Omit<TimeEntry, "id">>): Promise<TimeEntry | null> {
		return this.apply((state) => {
			const entry = state.entries.find((e) => e.id === entryId);
			if (!entry) return { result: null, changed: false };
			Object.assign(entry, patch);
			return { result: entry };
		});
	}

	// Deletion by explicit id. A deletion is never inferred by diffing
	// arrays: a session missing from memory may just be stale memory, not
	// a deletion.
	async deleteEntry(entryId: string): Promise<boolean> {
		return this.apply((state) => {
			const index = state.entries.findIndex((e) => e.id === entryId);
			if (index === -1) return { result: false, changed: false };
			state.entries.splice(index, 1);
			return { result: true };
		});
	}

	async updateSettings(fn: (settings: PluginSettings) => void): Promise<void> {
		await this.apply((state) => {
			fn(state.settings);
			return { result: undefined };
		});
	}

	// this.queue never rejects (it is always remapped to a resolved
	// promise): a failing operation does not break the queue, and its
	// error propagates only to that operation's caller.
	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const next = this.queue.then(task);
		this.queue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}
}
