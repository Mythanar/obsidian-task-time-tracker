// core/TaskIdentifier.ts
// Fase 2 — Vinculacion robusta a tareas.
// Responsabilidad: generar/leer el identificador inline ([tt-id:: id]) en
// la linea de la tarea, y resolver su ubicacion actual en el vault (o
// detectar que ya no existe).
//
// Formato con corchetes: es la sintaxis de inline field que Dataview
// necesita para reconocer tt-id como campo estructurado (sin corchetes,
// Dataview no lo detecta como campo).

import { App, MarkdownView, TFile } from "obsidian";

const TASK_ID_REGEX = /\[tt-id::\s*([0-9A-Za-z]+)\]/;
// Viñeta: "-", "*", "+" o lista numerada ("1.", "2.", ...). El \s* inicial
// cubre la indentacion, asi que las tareas anidadas se detectan igual.
const CHECKBOX_LINE_REGEX = /^\s*(?:[-*+]|\d+\.)\s*\[.\]\s*(.+?)\s*$/;
const CHECKBOX_STATE_REGEX = /^\s*(?:[-*+]|\d+\.)\s*\[(.)\]/;

const NANOID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const NANOID_LENGTH = 8;

export function generateTaskId(): string {
	const bytes = new Uint8Array(NANOID_LENGTH);
	crypto.getRandomValues(bytes);
	let id = "";
	for (const byte of bytes) {
		id += NANOID_ALPHABET[byte % NANOID_ALPHABET.length];
	}
	return id;
}

export function extractTaskId(line: string): string | null {
	return line.match(TASK_ID_REGEX)?.[1] ?? null;
}

export function appendTaskId(line: string, taskId: string): string {
	return `${line.trimEnd()} [tt-id:: ${taskId}]`;
}

export function stripTaskId(text: string): string {
	return text.replace(TASK_ID_REGEX, "").trim();
}

// Estado del checkbox (el caracter dentro de "[ ]"), o null si la linea
// no es un checkbox. "x" (hecha) y "-" (cancelada) son los unicos estados
// que Fase 5 trata como "cerrados"; cualquier otro (incluido " " vacio y
// estados personalizados de Tasks como "/") se trata como abierto.
export function extractCheckboxState(line: string): string | null {
	return line.match(CHECKBOX_STATE_REGEX)?.[1] ?? null;
}

export function isClosedCheckboxState(state: string | null): boolean {
	return state === "x" || state === "-";
}

// Extrae la descripcion de una linea de tarea tipo Tasks (checkbox con
// viñeta "-", "*", "+" o numerada, indentada o no), sin el marcador de
// checkbox ni el tt-id::. Devuelve null si la linea no es un checkbox.
export function parseCheckboxLine(line: string): string | null {
	const match = line.match(CHECKBOX_LINE_REGEX);
	if (!match) return null;
	return stripTaskId(match[1] ?? "");
}

export interface ResolvedTask {
	filePath: string;
	lineText: string;
	lineNumber: number;
}

export class TaskIdentifier {
	constructor(private app: App) {}

	// Busca en el vault la primera linea que contenga el tt-id dado.
	// Si el mismo id aparece en mas de una linea (copiado a otra nota o
	// duplicado), se toma la primera coincidencia; no hace falta resolver
	// ese conflicto en esta fase, todas cuentan como la misma tarea a
	// efectos de tiempo acumulado.
	async resolve(taskId: string): Promise<ResolvedTask | null> {
		return this.searchFiles(taskId, this.app.vault.getMarkdownFiles());
	}

	// Fase 5 UX — panel de Historial: variante de resolve() para el link
	// "abrir nota" de una tarjeta de tarea. Si el mismo tt-id aparece en
	// varias notas (duplicados, ver resolve()), prioriza la nota de la
	// sesion mas reciente (preferredPath, el mismo criterio que ya usa la
	// exportacion a CSV para "nota de origen": el snapshot de la sesion,
	// no una busqueda en vivo) antes de caer al criterio generico de
	// Fase 2 (primera coincidencia en todo el vault) si esa nota ya no
	// contiene el tt-id (p.ej. la tarea se movio a otra nota).
	async resolvePreferring(taskId: string, preferredPath: string): Promise<ResolvedTask | null> {
		const preferred = this.app.vault.getAbstractFileByPath(preferredPath);
		if (preferred instanceof TFile) {
			const found = await this.searchFiles(taskId, [preferred]);
			if (found) return found;
		}
		return this.resolve(taskId);
	}

	private async searchFiles(taskId: string, files: TFile[]): Promise<ResolvedTask | null> {
		const liveContents = this.getLiveEditorContents();

		for (const file of files) {
			// La misma nota puede estar abierta en varios leaves (paneles
			// divididos, Edicion + Lectura a la vez) con contenido
			// momentaneamente distinto entre si — cada uno tiene su propia
			// instancia de editor, y no se sincronizan entre ellos al
			// instante. Probar todos los candidatos en vivo (no solo uno)
			// antes de caer a cachedRead(): basta con que UNO de los
			// paneles ya tenga el tt-id en memoria (p.ej. el que acaba de
			// iniciar tracking) para resolverlo, sin depender de cual se
			// itere ultimo.
			// Si ninguno matchea, se cae a cachedRead() igualmente (no se
			// da por buena la ausencia solo porque el archivo este abierto):
			// en el arranque en frio, un MarkdownView puede existir con su
			// `file` ya asignado pero el editor todavia sin cargar el
			// contenido real (buffer vacio un instante), y ese candidato en
			// vivo no debe tratarse como prueba de que el tt-id no esta ahi
			// (bug de QA, agosto 2026 — "Task not found" con sesiones de
			// hoy en frio, misma familia que el bug de paneles duplicados).
			const candidates = liveContents.get(file.path) ?? [];
			const found = this.findInContents(taskId, file.path, candidates);
			if (found) return found;

			const cached = await this.app.vault.cachedRead(file);
			const foundInCache = this.findInContents(taskId, file.path, [cached]);
			if (foundInCache) return foundInCache;
		}
		return null;
	}

	private findInContents(taskId: string, filePath: string, contents: string[]): ResolvedTask | null {
		for (const content of contents) {
			const lines = content.split("\n");
			for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
				const lineText = lines[lineNumber];
				if (lineText !== undefined && extractTaskId(lineText) === taskId) {
					return { filePath, lineText, lineNumber };
				}
			}
		}
		return null;
	}

	// Los cambios hechos vía la API de Editor (p.ej. insertar el tt-id::
	// al iniciar tracking) tardan un momento en volcarse a disco, y
	// vault.cachedRead() no los ve hasta entonces. Para notas abiertas
	// se lee el contenido en vivo del editor para no marcar como
	// "no encontrada" una tarea que se está trackeando activamente.
	// Devuelve TODOS los contenidos en vivo por ruta, no uno solo: si la
	// misma nota esta abierta en mas de un leaf, cada uno puede tener un
	// estado distinto en un instante dado (ver bug documentado en
	// DECISIONES.md, "paneles duplicados").
	private getLiveEditorContents(): Map<string, string[]> {
		const contents = new Map<string, string[]>();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.file) {
				const path = leaf.view.file.path;
				const existing = contents.get(path) ?? [];
				existing.push(leaf.view.editor.getValue());
				contents.set(path, existing);
			}
		}
		return contents;
	}
}
