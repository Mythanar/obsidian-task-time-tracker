// core/ProjectManager.ts
// Projects and clients: two independent lists (format 2, see
// ClientMigration.ts), and the live task<->project and task<->client
// links by tt-id. Never calls an external API: there is no way to
// validate these names against the real platform, and none is needed
// (see CLAUDE.md).

import { isNewerFormat, StateStore } from "./StateStore";
import { nameKey } from "./ClientMigration";
import { Client, PluginState, Project } from "../types";

// Same pattern as TrackingEngine.ts: a non-cryptographic id is enough for a
// purely local entity that doesn't need strong collision resistance.
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// "newer-format": the data comes from a plugin version with a newer data
// format (see StateStore.ts#isNewerFormat). Projects and clients are not
// edited from here then, so this device does not write them in the old
// shape. Checked against the state just read inside each mutation.
export type NameResult = { ok: true } | { ok: false; error: "empty-name" | "duplicate" | "newer-format" };
// added: names created, in paste order. skipped: lines left out because
// the name was already in the list or earlier in the same paste (as
// pasted, trimmed).
export type ImportNamesResult = { ok: true; added: string[]; skipped: string[] } | { ok: false; error: "newer-format" };

export type ListKind = "project" | "client";

interface NamedItem {
	id: string;
	name: string;
}

// An alias (see types.ts#Project.aliasOf) only counts while the project
// it points to exists; otherwise the entry is shown as a project of its
// own, so nothing is ever hidden for good by damaged data.
function canonicalProject(projects: Project[], project: Project): Project {
	if (!project.aliasOf) return project;
	return projects.find((p) => p.id === project.aliasOf && !p.aliasOf) ?? project;
}

function visibleProjects(projects: Project[]): Project[] {
	return projects.filter((p) => canonicalProject(projects, p) === p);
}

// Names are unique within each list, ignoring case and repeated spaces
// (same rule as the migration). Always checked against the state passed
// in (the one just read from disk inside a mutation).
function nameTaken(items: NamedItem[], name: string, excludeId?: string): boolean {
	const key = nameKey(name);
	return items.some((item) => item.id !== excludeId && nameKey(item.name) === key);
}

export class ProjectManager {
	constructor(private store: StateStore) {}

	// Read from the in-memory state, for the UI. Mutations re-check it
	// against the state just read from disk.
	isLocked(): boolean {
		return this.store.isNewerFormat();
	}

	// Aliases left out: each project name appears once.
	getProjects(): Project[] {
		return visibleProjects(this.store.getState().projects);
	}

	getClients(): Client[] {
		return this.store.getState().clients;
	}

	getItems(kind: ListKind): NamedItem[] {
		return kind === "project" ? this.getProjects() : this.getClients();
	}

	// Live link by tt-id (not a snapshot): the project assigned to a task
	// right now (an alias resolves to its project), or null.
	getProjectForTask(taskId: string): Project | null {
		const state = this.store.getState();
		const projectId = state.taskProjects[taskId];
		if (!projectId) return null;
		const project = state.projects.find((p) => p.id === projectId);
		return project ? canonicalProject(state.projects, project) : null;
	}

	// Same for the client, independent from the project.
	getClientForTask(taskId: string): Client | null {
		const state = this.store.getState();
		const clientId = state.taskClients[taskId];
		if (!clientId) return null;
		return state.clients.find((c) => c.id === clientId) ?? null;
	}

	// How many tasks use this project (its aliases included) or client
	// right now, for the delete confirmation (see ProjectsSection.ts).
	countTasksUsing(kind: ListKind, id: string): number {
		const state = this.store.getState();
		if (kind === "client") return Object.values(state.taskClients).filter((c) => c === id).length;
		const ids = this.projectFamily(state, id);
		return Object.values(state.taskProjects).filter((p) => ids.has(p)).length;
	}

	// A project's id plus the ids of its aliases.
	private projectFamily(state: PluginState, projectId: string): Set<string> {
		return new Set([projectId, ...state.projects.filter((p) => p.aliasOf === projectId).map((p) => p.id)]);
	}

	private static list(state: PluginState, kind: ListKind): NamedItem[] {
		return kind === "project" ? visibleProjects(state.projects) : state.clients;
	}

	async add(kind: ListKind, rawName: string): Promise<NameResult> {
		const name = rawName.trim();
		if (name.length === 0) return { ok: false, error: "empty-name" };

		return this.store.apply<NameResult>((state) => {
			if (isNewerFormat(state)) return { result: { ok: false, error: "newer-format" }, changed: false };
			if (nameTaken(ProjectManager.list(state, kind), name)) {
				return { result: { ok: false, error: "duplicate" }, changed: false };
			}
			if (kind === "project") state.projects.push({ id: generateId(), name });
			else state.clients.push({ id: generateId(), name });
			return { result: { ok: true } };
		});
	}

	// Inline rename from Settings. Only this item is edited inside the
	// state just read from disk; the rest of the list (including items
	// created on another device) is left untouched. Renaming a project
	// renames its aliases too, so older plugin versions show the new name.
	// A client rename never touches the frozen client text in projects.
	async rename(kind: ListKind, id: string, rawName: string): Promise<NameResult> {
		const name = rawName.trim();
		if (name.length === 0) return { ok: false, error: "empty-name" };

		return this.store.apply<NameResult>((state) => {
			if (isNewerFormat(state)) return { result: { ok: false, error: "newer-format" }, changed: false };
			const item = ProjectManager.list(state, kind).find((i) => i.id === id);
			if (!item) return { result: { ok: true }, changed: false };
			if (nameTaken(ProjectManager.list(state, kind), name, id)) {
				return { result: { ok: false, error: "duplicate" }, changed: false };
			}
			item.name = name;
			if (kind === "project") {
				for (const alias of state.projects) if (alias.aliasOf === id) alias.name = name;
			}
			return { result: { ok: true } };
		});
	}

	// Removing an item in use silently leaves those tasks "without a
	// project" / "without a client" (no special marker): their
	// assignments are cleaned up first, then the item itself (a project
	// together with its aliases).
	async remove(kind: ListKind, id: string): Promise<void> {
		await this.store.apply((state) => {
			if (isNewerFormat(state)) return { result: undefined, changed: false };
			if (kind === "client") {
				const index = state.clients.findIndex((c) => c.id === id);
				if (index === -1) return { result: undefined, changed: false };
				state.clients.splice(index, 1);
				for (const taskId of Object.keys(state.taskClients)) {
					if (state.taskClients[taskId] === id) delete state.taskClients[taskId];
				}
				return { result: undefined };
			}
			if (!state.projects.some((p) => p.id === id)) return { result: undefined, changed: false };
			const ids = this.projectFamily(state, id);
			state.projects = state.projects.filter((p) => !ids.has(p.id));
			for (const taskId of Object.keys(state.taskProjects)) {
				if (ids.has(state.taskProjects[taskId] ?? "")) delete state.taskProjects[taskId];
			}
			return { result: undefined };
		});
	}

	// Paste list: one name per line, empty lines ignored. Names not in the
	// list yet are added; names already there, or repeated earlier in the
	// same paste (ignoring case and spaces, see nameKey), are skipped and
	// reported, all of them.
	async importNames(kind: ListKind, text: string): Promise<ImportNamesResult> {
		// Checking against what is already stored needs the latest state
		// from disk, so parsing and insertion live in the same mutation.
		return this.store.apply<ImportNamesResult>((state) => {
			if (isNewerFormat(state)) return { result: { ok: false, error: "newer-format" }, changed: false };
			const existing = ProjectManager.list(state, kind);
			const seen = new Set<string>();
			const added: string[] = [];
			const skipped: string[] = [];
			for (const line of text.split("\n")) {
				const name = line.trim();
				if (name.length === 0) continue;
				const key = nameKey(name);
				if (seen.has(key) || nameTaken(existing, name)) {
					skipped.push(name);
					continue;
				}
				seen.add(key);
				added.push(name);
			}
			for (const name of added) {
				if (kind === "project") state.projects.push({ id: generateId(), name });
				else state.clients.push({ id: generateId(), name });
			}
			return { result: { ok: true, added, skipped }, changed: added.length > 0 };
		});
	}

	// id null unassigns (deletes the key); otherwise it assigns/reassigns,
	// with no confirmation screen. Only THIS task's key is touched: every
	// other assignment on disk is preserved as is. Reassigning updates the
	// task's whole history (live link, not a snapshot).
	async assignProject(taskId: string, projectId: string | null): Promise<void> {
		await this.assign("project", taskId, projectId);
	}

	async assignClient(taskId: string, clientId: string | null): Promise<void> {
		await this.assign("client", taskId, clientId);
	}

	async assign(kind: ListKind, taskId: string, id: string | null): Promise<void> {
		await this.store.apply((state) => {
			const map = kind === "project" ? state.taskProjects : state.taskClients;
			if (id === null) {
				if (!(taskId in map)) return { result: undefined, changed: false };
				delete map[taskId];
			} else {
				// Picking the project a task already has through an alias
				// keeps the alias (nothing changes for older versions).
				if (kind === "project" && map[taskId]) {
					const current = state.projects.find((p) => p.id === map[taskId]);
					if (current && canonicalProject(state.projects, current).id === id) {
						return { result: undefined, changed: false };
					}
				}
				if (map[taskId] === id) return { result: undefined, changed: false };
				map[taskId] = id;
			}
			return { result: undefined };
		});
	}
}
