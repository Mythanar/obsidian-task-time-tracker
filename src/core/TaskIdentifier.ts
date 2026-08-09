// core/TaskIdentifier.ts
// Fase 2 — Vinculacion robusta a tareas.
// Responsabilidad: generar/leer el identificador inline ([tt-id:: id]) en
// la linea de la tarea, y resolver su ubicacion actual en el vault (o
// detectar que ya no existe).
//
// Formato con corchetes: es la sintaxis de inline field que Dataview
// necesita para reconocer tt-id como campo estructurado (sin corchetes,
// Dataview no lo detecta como campo).

import { App, MarkdownView } from "obsidian";

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
		const liveContents = this.getLiveEditorContents();

		for (const file of this.app.vault.getMarkdownFiles()) {
			const content = liveContents.get(file.path) ?? (await this.app.vault.cachedRead(file));
			const lines = content.split("\n");
			for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
				const lineText = lines[lineNumber];
				if (lineText !== undefined && extractTaskId(lineText) === taskId) {
					return { filePath: file.path, lineText, lineNumber };
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
	private getLiveEditorContents(): Map<string, string> {
		const contents = new Map<string, string>();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.file) {
				contents.set(leaf.view.file.path, leaf.view.editor.getValue());
			}
		}
		return contents;
	}
}
