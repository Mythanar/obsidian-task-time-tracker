// core/ProjectManager.ts
// Fase 8 — alta/baja de proyectos y clientes (base para futuros adapters
// de exportacion tipo Clockify). Nunca llama a ninguna API externa: no hay
// forma de validar estos nombres contra la plataforma real, ni falta que
// hace (ver CLAUDE.md).

import { PluginState, Project } from "../types";

// Mismo patron que TrackingEngine.ts: id no criptografico, suficiente para
// una entidad puramente local sin necesidad de colision-resistencia fuerte.
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type AddProjectResult = { ok: true } | { ok: false; error: "empty-name" | "duplicate" };
export type ImportProjectsResult = { ok: true } | { ok: false; line: number; content: string };

export class ProjectManager {
	constructor(
		private state: PluginState,
		private persist: (state: PluginState) => Promise<void>,
	) {}

	getProjects(): Project[] {
		return this.state.projects;
	}

	// La identidad unica de un proyecto es la pareja (name, client) exacta;
	// "sin cliente" cuenta como su propio valor, distinto de cualquier
	// client real (ver types.ts#Project).
	private exists(name: string, client: string | undefined): boolean {
		return this.state.projects.some((p) => p.name === name && (p.client ?? "") === (client ?? ""));
	}

	async addProject(rawName: string, rawClient: string): Promise<AddProjectResult> {
		const name = rawName.trim();
		if (name.length === 0) return { ok: false, error: "empty-name" };

		const client = rawClient.trim() || undefined;
		if (this.exists(name, client)) return { ok: false, error: "duplicate" };

		this.state.projects.push({ id: generateId(), name, client });
		await this.persist(this.state);
		return { ok: true };
	}

	// Borrar un proyecto en uso deja a esas tareas "sin proyecto" en
	// silencio (sin marca especial, ver docs de "Configurar proyectos") —
	// se limpia primero taskProjects, luego la propia lista de proyectos.
	async removeProject(id: string): Promise<void> {
		const index = this.state.projects.findIndex((p) => p.id === id);
		if (index === -1) return;
		this.state.projects.splice(index, 1);
		for (const taskId of Object.keys(this.state.taskProjects)) {
			if (this.state.taskProjects[taskId] === id) delete this.state.taskProjects[taskId];
		}
		await this.persist(this.state);
	}

	// Cuantas tareas tienen este proyecto asignado ahora mismo, para el
	// aviso de confirmacion de borrado (ver ProjectsSection.ts).
	countTasksUsingProject(projectId: string): number {
		return Object.values(this.state.taskProjects).filter((id) => id === projectId).length;
	}

	// Vinculo vivo por tt-id (no snapshot): resuelve el proyecto asignado a
	// una tarea ahora mismo, o null si no tiene ninguno.
	getProjectForTask(taskId: string): Project | null {
		const projectId = this.state.taskProjects[taskId];
		if (!projectId) return null;
		return this.state.projects.find((p) => p.id === projectId) ?? null;
	}

	// projectId null desasigna (borra la clave); si no, asigna/reasigna.
	// Reasignar reemplaza el valor anterior sin pantalla de confirmacion —
	// ver Asignar proyectos.md.
	async assignProject(taskId: string, projectId: string | null): Promise<void> {
		if (projectId === null) {
			delete this.state.taskProjects[taskId];
		} else {
			this.state.taskProjects[taskId] = projectId;
		}
		await this.persist(this.state);
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
			if (seenInBatch.has(key) || this.exists(name, client)) {
				return { ok: false, line: i + 1, content: line };
			}
			seenInBatch.add(key);
			toAdd.push({ name, client });
		}

		for (const project of toAdd) {
			this.state.projects.push({ id: generateId(), name: project.name, client: project.client });
		}
		await this.persist(this.state);
		return { ok: true };
	}
}
