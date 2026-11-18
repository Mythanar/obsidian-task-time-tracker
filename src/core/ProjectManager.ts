// core/ProjectManager.ts
// Projects and clients: two independent lists (format 2, see
// ClientMigration.ts), and the live task<->project and task<->client
// links by tt-id. Never calls an external API: there is no way to
// validate these names against the real platform, and none is needed
// (see CLAUDE.md).

import { isNewerFormat, StateStore } from "./StateStore";
import { nameKey } from "./ClientMigration";
import {
	canonicalProject,
	computeLinkImpact,
	LinkImpact,
	normalizeFolderPath,
	projectWithFolder,
	ProjectResolution,
	resolveTaskProject,
	TaskInfo,
	visibleProjects,
} from "./ProjectFolders";
import { isInTrackingFolders } from "./TrackingFolders";
import { Client, PluginState, Project } from "../types";

// Same pattern as TrackingEngine.ts: a non-cryptographic id is enough for a
// purely local entity that doesn't need strong collision resistance.
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Placeholder id of a project not created yet, for the link impact of
// the "Add" form (see linkImpact()).
const NEW_PROJECT_ID = "\u0000new";

// "newer-format": the data comes from a plugin version with a newer data
// format (see StateStore.ts#isNewerFormat). Projects and clients are not
// edited from here then, so this device does not write them in the old
// shape. Checked against the state just read inside each mutation.
// "folder-taken": another project already has that folder (its name in
// takenBy). "folder-outside": the folder isn't inside Tracking folders
// and the caller didn't ask to add it (see saveProject()).
export type NameResult =
	| { ok: true }
	| { ok: false; error: "empty-name" | "duplicate" | "newer-format" | "folder-outside" }
	| { ok: false; error: "folder-taken"; takenBy: string };
// added: names created, in paste order. skipped: lines left out because
// the name was already in the list or earlier in the same paste (as
// pasted, trimmed).
export type ImportNamesResult = { ok: true; added: string[]; skipped: string[] } | { ok: false; error: "newer-format" };

export type ListKind = "project" | "client";

interface NamedItem {
	id: string;
	name: string;
}

// Names are unique within each list, ignoring case and repeated spaces
// (same rule as the migration). Always checked against the state passed
// in (the one just read from disk inside a mutation).
function nameTaken(items: NamedItem[], name: string, excludeId?: string): boolean {
	const key = nameKey(name);
	return items.some((item) => item.id !== excludeId && nameKey(item.name) === key);
}

// Where a task's note is right now (see core/TaskLocations.ts), or null
// if unknown. Injected so this class stays free of the Obsidian API.
export type TaskLocator = (taskId: string) => string | null;

export interface TaskProjectInfo extends ProjectResolution {
	notePath: string | null;
}

export class ProjectManager {
	constructor(
		private store: StateStore,
		private locate: TaskLocator = () => null,
	) {}

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

	// Pre-check for the Settings forms, on the in-memory state (the save
	// checks again against the state just read from disk).
	isNameTaken(kind: ListKind, name: string, excludeId?: string): boolean {
		return nameTaken(this.getItems(kind), name.trim(), excludeId);
	}

	getItems(kind: ListKind): NamedItem[] {
		return kind === "project" ? this.getProjects() : this.getClients();
	}

	// The task's EFFECTIVE project (see core/ProjectFolders.ts): its
	// note's folder project, else its manual assignment (live link by
	// tt-id, an alias resolves to its project), else null. Computed on
	// every read, never stored: every reader (History, its filter,
	// Dashboard, Edit task, the three CSV exports) goes through here, so
	// the whole history follows the current configuration.
	getProjectForTask(taskId: string): Project | null {
		return this.getProjectInfo(taskId).project;
	}

	// Same, plus where it comes from and the note path it was computed
	// with, for the Edit task modal.
	getProjectInfo(taskId: string): TaskProjectInfo {
		const state = this.store.getState();
		const notePath = this.locate(taskId);
		return { ...resolveTaskProject(state.projects, state.taskProjects[taskId], notePath), notePath };
	}

	// Same for the client, independent from the project.
	getClientForTask(taskId: string): Client | null {
		const state = this.store.getState();
		const clientId = state.taskClients[taskId];
		if (!clientId) return null;
		return state.clients.find((c) => c.id === clientId) ?? null;
	}

	// How many tasks use this project or client right now, for the
	// delete confirmation (see ProjectsSection.ts). A project counts the
	// tasks it is the effective project of (folder or manual).
	countTasksUsing(kind: ListKind, id: string): number {
		const state = this.store.getState();
		if (kind === "client") return Object.values(state.taskClients).filter((c) => c === id).length;
		return this.taskInfos(state, true).filter(
			(task) => resolveTaskProject(state.projects, task.manualProjectId, task.notePath).project?.id === id,
		).length;
	}

	// Every tracked task (the ones the History shows), with its manual
	// project, current note and tracked time. The D1/D2 dialog leaves out
	// a project assignment left behind by a task whose sessions were all
	// deleted: no screen shows that task, so its count wouldn't match.
	// The delete confirmation keeps counting it (withAssignedOnly), as it
	// did before folders existed: deleting the project removes that
	// assignment too.
	private taskInfos(state: PluginState, withAssignedOnly = false): TaskInfo[] {
		const tracked = new Map<string, number>();
		const now = Date.now();
		for (const entry of state.entries) {
			tracked.set(entry.taskId, (tracked.get(entry.taskId) ?? 0) + ((entry.end ?? now) - entry.start));
		}
		if (withAssignedOnly) {
			for (const taskId of Object.keys(state.taskProjects)) if (!tracked.has(taskId)) tracked.set(taskId, 0);
		}
		return [...tracked].map(([taskId, trackedMs]) => ({
			taskId,
			manualProjectId: state.taskProjects[taskId],
			notePath: this.locate(taskId),
			trackedMs,
		}));
	}

	// What saving this folder link would change, for the confirmation
	// dialog (D1/D2), computed on the in-memory state before anything is
	// saved. projectId null: a project not created yet (the "Add" form).
	linkImpact(projectId: string | null, folder: string | null): LinkImpact {
		const state = this.store.getState();
		const id = projectId ?? NEW_PROJECT_ID;
		const target = normalizeFolderPath(folder);
		const after = state.projects.map((p) => (p.id === id ? { ...p, folder: target } : p));
		if (!projectId) after.push({ id, name: "", folder: target });
		return computeLinkImpact(id, state.projects, after, this.taskInfos(state));
	}

	// A project's id plus the ids of its aliases.
	private projectFamily(state: PluginState, projectId: string): Set<string> {
		return new Set([projectId, ...state.projects.filter((p) => p.aliasOf === projectId).map((p) => p.id)]);
	}

	private static list(state: PluginState, kind: ListKind): NamedItem[] {
		return kind === "project" ? visibleProjects(state.projects) : state.clients;
	}

	async add(kind: ListKind, rawName: string): Promise<NameResult> {
		return kind === "project" ? this.saveProject(null, rawName, null) : this.saveClient(null, rawName);
	}

	// Inline rename from Settings. Only this item is edited inside the
	// state just read from disk; the rest of the list (including items
	// created on another device) is left untouched. Renaming a project
	// renames its aliases too, so older plugin versions show the new name.
	// A client rename never touches the frozen client text in projects.
	async rename(kind: ListKind, id: string, rawName: string): Promise<NameResult> {
		if (kind === "client") return this.saveClient(id, rawName);
		const project = this.getProjects().find((p) => p.id === id);
		return this.saveProject(id, rawName, project?.folder ?? null);
	}

	private async saveClient(id: string | null, rawName: string): Promise<NameResult> {
		const name = rawName.trim();
		if (name.length === 0) return { ok: false, error: "empty-name" };

		return this.store.apply<NameResult>((state) => {
			if (isNewerFormat(state)) return { result: { ok: false, error: "newer-format" }, changed: false };
			if (nameTaken(state.clients, name, id ?? undefined)) {
				return { result: { ok: false, error: "duplicate" }, changed: false };
			}
			if (id === null) {
				state.clients.push({ id: generateId(), name });
				return { result: { ok: true } };
			}
			const client = state.clients.find((c) => c.id === id);
			if (!client || client.name === name) return { result: { ok: true }, changed: false };
			client.name = name;
			return { result: { ok: true } };
		});
	}

	// Creates (id null) or updates a project: name and folder in one
	// save. folder null unlinks. A new or changed folder must be inside
	// Tracking folders (any folder if the list is empty), unless
	// addToTracking: then it is added to Tracking folders in this same
	// save ("Add to Tracking folders" links in one step). Both checks run
	// against the state just read from disk.
	async saveProject(
		id: string | null,
		rawName: string,
		rawFolder: string | null,
		options: { addToTracking?: boolean } = {},
	): Promise<NameResult> {
		const name = rawName.trim();
		if (name.length === 0) return { ok: false, error: "empty-name" };
		const folder = normalizeFolderPath(rawFolder);

		return this.store.apply<NameResult>((state) => {
			if (isNewerFormat(state)) return { result: { ok: false, error: "newer-format" }, changed: false };
			const projects = visibleProjects(state.projects);
			const project = id === null ? null : projects.find((p) => p.id === id);
			if (id !== null && !project) return { result: { ok: true }, changed: false };
			if (nameTaken(projects, name, id ?? undefined)) {
				return { result: { ok: false, error: "duplicate" }, changed: false };
			}
			const folderChanged = folder !== undefined && folder !== project?.folder;
			if (folderChanged) {
				const other = projectWithFolder(state.projects, folder, id ?? undefined);
				if (other) return { result: { ok: false, error: "folder-taken", takenBy: other.name }, changed: false };
				if (!isInTrackingFolders(folder, state.settings.trackingFolders)) {
					if (!options.addToTracking) return { result: { ok: false, error: "folder-outside" }, changed: false };
					state.settings.trackingFolders = [...state.settings.trackingFolders, folder];
				}
			}

			if (!project) {
				state.projects.push({ id: generateId(), name, folder });
				return { result: { ok: true } };
			}
			if (project.name === name && project.folder === folder) return { result: { ok: true }, changed: false };
			project.name = name;
			project.folder = folder;
			for (const alias of state.projects) if (alias.aliasOf === project.id) alias.name = name;
			return { result: { ok: true } };
		});
	}

	// "Remove link": the project keeps its name and becomes a manual
	// one again; tasks get their latent manual assignment back.
	async unlinkFolder(id: string): Promise<void> {
		await this.store.apply((state) => {
			if (isNewerFormat(state)) return { result: undefined, changed: false };
			const project = state.projects.find((p) => p.id === id);
			if (!project?.folder) return { result: undefined, changed: false };
			project.folder = undefined;
			return { result: undefined };
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
