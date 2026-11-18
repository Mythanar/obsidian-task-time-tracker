// core/TaskLocations.ts
// In-memory index tt-id -> notes that currently hold it. "Project by
// folder" needs each task's CURRENT note path (sessions only keep the
// path from when they started, see types.ts#TimeEntry). Built once when
// the layout is ready and kept up to date from the vault's modify,
// create, delete and rename events (see main.ts). Never persisted, never
// written to the notes. No Obsidian API here, so it can be tested.
//
// When a task isn't found in the vault (note deleted, index not built
// yet, change made outside Obsidian not seen yet), the caller falls back
// to the path of the task's latest session (see locate()).

import { isPathInFolder } from "./TrackingFolders";

// Same pattern as TaskIdentifier.ts#TASK_ID_REGEX, global. Not imported
// from there: that module needs the Obsidian API at runtime, and this one
// is tested without it.
const TASK_ID_GLOBAL_REGEX = /\[tt-id::\s*([0-9A-Za-z]+)\]/g;

// Every tt-id in a note's content. Cheap discard first: most notes have
// no tracked task at all.
export function taskIdsIn(content: string): Set<string> {
	const ids = new Set<string>();
	if (!content.includes("[tt-id::")) return ids;
	for (const match of content.matchAll(TASK_ID_GLOBAL_REGEX)) {
		if (match[1]) ids.add(match[1]);
	}
	return ids;
}

function sameSet(a: ReadonlySet<string> | undefined, b: ReadonlySet<string>): boolean {
	if (!a) return b.size === 0;
	if (a.size !== b.size) return false;
	for (const item of a) if (!b.has(item)) return false;
	return true;
}

export class TaskLocations {
	private byPath = new Map<string, Set<string>>();
	private byTask = new Map<string, Set<string>>();
	private ready = false;

	isReady(): boolean {
		return this.ready;
	}

	markReady(): void {
		this.ready = true;
	}

	// Sets the tt-ids a note holds now. Returns whether they changed, so
	// the caller only refreshes the views when a task moved between notes.
	setFile(path: string, ids: ReadonlySet<string>): boolean {
		const current = this.byPath.get(path);
		if (sameSet(current, ids)) return false;
		this.removeFile(path);
		if (ids.size === 0) return true;
		this.byPath.set(path, new Set(ids));
		for (const id of ids) {
			const paths = this.byTask.get(id) ?? new Set<string>();
			paths.add(path);
			this.byTask.set(id, paths);
		}
		return true;
	}

	removeFile(path: string): boolean {
		const ids = this.byPath.get(path);
		if (!ids) return false;
		this.byPath.delete(path);
		for (const id of ids) {
			const paths = this.byTask.get(id);
			if (!paths) continue;
			paths.delete(path);
			if (paths.size === 0) this.byTask.delete(id);
		}
		return true;
	}

	// A note or folder deleted: drops every indexed note at or below it.
	removeUnder(path: string): boolean {
		let changed = false;
		for (const indexed of [...this.byPath.keys()]) {
			if (isPathInFolder(indexed, path) && this.removeFile(indexed)) changed = true;
		}
		return changed;
	}

	// The tt-ids of a note (empty if none or unknown).
	idsIn(path: string): string[] {
		return [...(this.byPath.get(path) ?? [])];
	}

	// A note or folder renamed/moved: every indexed note at or below
	// oldPath moves with it. Returns the notes moved, as [oldPath,
	// newPath]. A repeat of the same rename is a no-op.
	rename(oldPath: string, newPath: string): [string, string][] {
		const moved: [string, string][] = [];
		for (const path of [...this.byPath.keys()]) {
			if (isPathInFolder(path, oldPath)) moved.push([path, newPath + path.slice(oldPath.length)]);
		}
		for (const [from, to] of moved) {
			const ids = this.byPath.get(from) ?? new Set<string>();
			this.removeFile(from);
			this.setFile(to, ids);
		}
		return moved;
	}

	// The task's current note. If the tt-id is in several notes (copied
	// or duplicated), the note of its latest session wins when it still
	// holds it, same criterion as the History card's title and note icon
	// (TaskIdentifier.ts#resolvePreferring); otherwise the first one in
	// path order, so the answer doesn't depend on indexing order. Not in
	// the vault (or index not ready): the latest session's path.
	locate(taskId: string, latestSessionPath: string | null): string | null {
		const paths = this.byTask.get(taskId);
		if (!paths || paths.size === 0) return latestSessionPath;
		if (latestSessionPath && paths.has(latestSessionPath)) return latestSessionPath;
		return [...paths].sort()[0] ?? latestSessionPath;
	}
}
