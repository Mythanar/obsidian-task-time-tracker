// core/ProjectManager.ts
// Never calls an external API: there is no way to validate these names
// against the real platform, and none is needed (see CLAUDE.md).

import { StateStore } from "./StateStore";
import { PluginState, Project } from "../types";

// Same pattern as TrackingEngine.ts: a non-cryptographic id is enough for a
// purely local entity that doesn't need strong collision resistance.
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type AddProjectResult = { ok: true } | { ok: false; error: "empty-name" | "duplicate" };
export type ImportProjectsResult = { ok: true } | { ok: false; line: number; content: string };

export class ProjectManager {
	constructor(private store: StateStore) {}

	getProjects(): Project[] {
		return this.store.getState().projects;
	}

	// A project's unique identity is the exact (name, client) pair; "no
	// client" counts as its own value, distinct from any real client (see
	// types.ts#Project). Always checked against the state passed in (the
	// one just read from disk inside a mutation), never against the
	// in-memory copy.
	private static exists(
		state: PluginState,
		name: string,
		client: string | undefined,
		excludeId?: string,
	): boolean {
		return state.projects.some(
			(p) => p.id !== excludeId && p.name === name && (p.client ?? "") === (client ?? ""),
		);
	}

	async addProject(rawName: string, rawClient: string): Promise<AddProjectResult> {
		const name = rawName.trim();
		if (name.length === 0) return { ok: false, error: "empty-name" };
		const client = rawClient.trim() || undefined;

		return this.store.apply<AddProjectResult>((state) => {
			if (ProjectManager.exists(state, name, client)) {
				return { result: { ok: false, error: "duplicate" }, changed: false };
			}
			state.projects.push({ id: generateId(), name, client });
			return { result: { ok: true } };
		});
	}

	// Inline editing from Settings > Projects & clients (one field at a
	// time, see ProjectsSection.ts). Same validation as addProject (name
	// not empty, unique name+client pair), excluding this project itself
	// from the duplicate check — otherwise a project with no real changes
	// would collide with itself.
	//
	// Only this project is edited inside the state just read from disk; the rest of the on-disk list
	// (including projects created on another device) is left untouched.
	// Consumers (TimeLogView via getProjectForTask, EditTaskModal) re-read
	// on every render, so they do not rely on keeping the object reference.
	async updateProject(id: string, rawName: string, rawClient: string): Promise<AddProjectResult> {
		const name = rawName.trim();
		if (name.length === 0) return { ok: false, error: "empty-name" };
		const client = rawClient.trim() || undefined;

		return this.store.apply<AddProjectResult>((state) => {
			const project = state.projects.find((p) => p.id === id);
			if (!project) return { result: { ok: true }, changed: false };
			if (ProjectManager.exists(state, name, client, id)) {
				return { result: { ok: false, error: "duplicate" }, changed: false };
			}
			project.name = name;
			project.client = client;
			return { result: { ok: true } };
		});
	}

	// Removing a project in use silently leaves those tasks "without a
	// project" (no special marker, see the "Configurar proyectos" docs) —
	// taskProjects is cleaned up first, then the project list itself.
	async removeProject(id: string): Promise<void> {
		await this.store.apply((state) => {
			const index = state.projects.findIndex((p) => p.id === id);
			if (index === -1) return { result: undefined, changed: false };
			state.projects.splice(index, 1);
			for (const taskId of Object.keys(state.taskProjects)) {
				if (state.taskProjects[taskId] === id) delete state.taskProjects[taskId];
			}
			return { result: undefined };
		});
	}

	// How many tasks have this project assigned right now, for the delete
	// confirmation warning (see ProjectsSection.ts).
	countTasksUsingProject(projectId: string): number {
		return Object.values(this.store.getState().taskProjects).filter((id) => id === projectId).length;
	}

	// Live link by tt-id (not a snapshot): resolves the project assigned
	// to a task right now, or null if it has none.
	getProjectForTask(taskId: string): Project | null {
		const state = this.store.getState();
		const projectId = state.taskProjects[taskId];
		if (!projectId) return null;
		return state.projects.find((p) => p.id === projectId) ?? null;
	}

	// projectId null unassigns (deletes the key); otherwise it assigns/
	// reassigns. Reassigning replaces the previous value with no
	// confirmation screen — see "Asignar proyectos.md". Only THIS task's
	// key is touched: every other assignment on disk is preserved as is.
	async assignProject(taskId: string, projectId: string | null): Promise<void> {
		await this.store.apply((state) => {
			if (projectId === null) {
				delete state.taskProjects[taskId];
			} else {
				state.taskProjects[taskId] = projectId;
			}
			return { result: undefined };
		});
	}

	// name+client uniqueness key for the in-batch duplicate Set.
	// JSON.stringify over the pair (instead of concatenating with a text
	// separator) avoids any collision between distinct pairs that share
	// the same characters split differently (e.g. name="A", client="B C"
	// vs name="A B", client="C").
	private static key(name: string, client: string | undefined): string {
		return JSON.stringify([name, client ?? ""]);
	}

	// Syntax: one line = one project, "Name; Client" (";" is a deliberate
	// separator, see the Settings docs — avoids clashing with client
	// names that already contain a comma). No client: the part after ";"
	// is omitted. All-or-nothing validation: if any line fails (bad
	// format, duplicate against what's already stored, or duplicate
	// within the paste itself), nothing is imported, and only the first
	// failing line is reported (number + literal content) — the rest of
	// the list isn't checked past that point.
	async importProjects(text: string): Promise<ImportProjectsResult> {
		// Validating against what is already stored needs the latest state
		// from disk, so parsing and insertion live in the same mutation.
		return this.store.apply<ImportProjectsResult>((state) => {
			const parsed = this.parseImport(state, text);
			if (!parsed.ok) return { result: parsed, changed: false };
			for (const project of parsed.toAdd) {
				state.projects.push({ id: generateId(), name: project.name, client: project.client });
			}
			return { result: { ok: true }, changed: parsed.toAdd.length > 0 };
		});
	}

	private parseImport(
		state: PluginState,
		text: string,
	): { ok: true; toAdd: { name: string; client?: string }[] } | { ok: false; line: number; content: string } {
		const lines = text.split("\n");
		const toAdd: { name: string; client?: string }[] = [];
		const seenInBatch = new Set<string>();

		for (let i = 0; i < lines.length; i++) {
			const line = (lines[i] ?? "").trim();
			if (line.length === 0) continue;

			// More than one ";" is ambiguous format (which part does the
			// text after the second separator belong to) — rejected
			// instead of guessed.
			const parts = line.split(";");
			if (parts.length > 2) return { ok: false, line: i + 1, content: line };

			const name = (parts[0] ?? "").trim();
			if (name.length === 0) return { ok: false, line: i + 1, content: line };

			const clientPart = parts[1]?.trim();
			const client = clientPart && clientPart.length > 0 ? clientPart : undefined;

			const key = ProjectManager.key(name, client);
			if (seenInBatch.has(key) || ProjectManager.exists(state, name, client)) {
				return { ok: false, line: i + 1, content: line };
			}
			seenInBatch.add(key);
			toAdd.push({ name, client });
		}

		return { ok: true, toAdd };
	}
}
