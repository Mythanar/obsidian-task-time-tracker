// core/ProjectManager.ts
// Fase 8 — alta/baja de proyectos y clientes (base para futuros adapters
// de exportacion tipo Clockify). Nunca llama a ninguna API externa: no hay
// forma de validar estos nombres contra la plataforma real, ni falta que
// hace (ver CLAUDE.md).

import { StateStore } from "./StateStore";
import { PluginState, Project } from "../types";

// Mismo patron que TrackingEngine.ts: id no criptografico, suficiente para
// una entidad puramente local sin necesidad de colision-resistencia fuerte.
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

	// La identidad unica de un proyecto es la pareja (name, client) exacta;
	// "sin cliente" cuenta como su propio valor, distinto de cualquier
	// client real (ver types.ts#Project). Always checked against the state
	// passed in (the one just read from disk inside a mutation), never
	// against the in-memory copy.
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

	// Edicion inline desde Settings > Projects & clients (un campo a la
	// vez, ver ProjectsSection.ts). Misma validacion que addProject
	// (nombre no vacio, pareja name+client unica), excluyendo el propio
	// proyecto del chequeo de duplicado — si no, un proyecto sin cambios
	// reales chocaria contra si mismo.
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

	// Borrar un proyecto en uso deja a esas tareas "sin proyecto" en
	// silencio (sin marca especial, ver docs de "Configurar proyectos") —
	// se limpia primero taskProjects, luego la propia lista de proyectos.
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

	// Cuantas tareas tienen este proyecto asignado ahora mismo, para el
	// aviso de confirmacion de borrado (ver ProjectsSection.ts).
	countTasksUsingProject(projectId: string): number {
		return Object.values(this.store.getState().taskProjects).filter((id) => id === projectId).length;
	}

	// Vinculo vivo por tt-id (no snapshot): resuelve el proyecto asignado a
	// una tarea ahora mismo, o null si no tiene ninguno.
	getProjectForTask(taskId: string): Project | null {
		const state = this.store.getState();
		const projectId = state.taskProjects[taskId];
		if (!projectId) return null;
		return state.projects.find((p) => p.id === projectId) ?? null;
	}

	// projectId null desasigna (borra la clave); si no, asigna/reasigna.
	// Reasignar reemplaza el valor anterior sin pantalla de confirmacion —
	// ver Asignar proyectos.md. Only THIS task's key is touched: every
	// other assignment on disk is preserved as is.
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

	// Clave de unicidad name+client para el Set de duplicados dentro de un
	// mismo pegado. JSON.stringify sobre el par (en vez de concatenar con
	// un separador de texto) evita cualquier colision entre pares
	// distintos que compartan los mismos caracteres repartidos de otra
	// forma (ej. name="A", client="B C" vs name="A B", client="C").
	private static key(name: string, client: string | undefined): string {
		return JSON.stringify([name, client ?? ""]);
	}

	// Sintaxis: una linea = un proyecto, "Nombre; Cliente" (";" como
	// separador deliberado, ver docs de Settings — evita el choque con
	// nombres de cliente que ya llevan coma). Sin cliente: se omite la
	// parte tras el ";". Validacion todo o nada: si cualquier linea falla
	// (formato, duplicada contra lo ya guardado, o duplicada dentro del
	// propio pegado) no se importa nada, y solo se reporta la primera
	// linea con problema (numero + contenido literal) — el resto de la
	// lista no se comprueba mas alla de ese punto.
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

			// Mas de un ";" es formato ambiguo (a que parte pertenece el
			// texto tras el segundo separador) — se rechaza en vez de
			// adivinar.
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
