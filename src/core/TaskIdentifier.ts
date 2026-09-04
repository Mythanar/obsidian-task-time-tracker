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

// Bug conocido de Tasks (issue #1505, ver docs/DECISIONES.md y la nota de
// bug en el vault): Tasks solo reconoce sus propios campos si quedan
// DESPUES del tt-id en la linea; si el tt-id queda detras de ellos, Tasks
// deja de reconocerlos todos por igual. La unica solucion fiable (no
// depende de que Tasks cambie nada) es controlar donde insertamos el
// tt-id: siempre antes de cualquier campo de Tasks presente en la linea.
// Lista completa de campos por emoji, segun el Tasks Emoji Format oficial.
const TASKS_DATE_MARKERS = ["➕", "📅", "⏳", "🛫", "✅", "❌"];
const TASKS_PRIORITY_MARKERS = ["🔺", "⏫", "🔼", "🔽", "⏬"];

// Cada patron reconoce UN campo de Tasks anclado al final de la cadena
// (ver findTasksMetadataStart): solo importa si ese campo es el ultimo
// tramo de la linea, no donde mas aparezca. El separador `(?:^|\s)` se
// incluye en el match a proposito, para que el corte tambien absorba el
// espacio que lo separaba del contenido anterior.
const TASKS_TRAILING_FIELD_PATTERNS: RegExp[] = [
	new RegExp(`(?:^|\\s)(?:${TASKS_DATE_MARKERS.join("|")})\\s?\\d{4}-\\d{2}-\\d{2}$`, "u"),
	new RegExp(`(?:^|\\s)(?:${TASKS_PRIORITY_MARKERS.join("|")})$`, "u"),
	/(?:^|\s)🏁\s?(?:keep|delete)$/u,
	/(?:^|\s)🆔\s?\S+$/u,
	/(?:^|\s)⛔\s?\S+$/u,
	/(?:^|\s)🔁\s?.+$/u,
];

// Recorre `text` desde el final hacia atras, igual que Tasks internamente,
// para encontrar donde empieza el bloque contiguo final de campos
// reconocidos. Devuelve el indice de corte (longitud de `text` si no hay
// ningun campo de Tasks al final).
function findTasksMetadataStart(text: string): number {
	const isWhitespace = (index: number) => /\s/.test(text[index] ?? "");

	let end = text.length;
	while (end > 0 && isWhitespace(end - 1)) end--;

	let cut = true;
	while (cut) {
		cut = false;
		const current = text.slice(0, end);
		for (const pattern of TASKS_TRAILING_FIELD_PATTERNS) {
			const match = pattern.exec(current);
			if (match) {
				end = match.index;
				while (end > 0 && isWhitespace(end - 1)) end--;
				cut = true;
				break;
			}
		}
	}
	return end;
}

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

// Inserta (o recoloca, si ya tenia uno mal colocado por una version
// anterior del plugin) el tt-id justo antes del bloque de metadatos de
// Tasks al final de la linea, o al final si no hay ninguno. Idempotente:
// si `line` ya tiene el tt-id bien colocado, devuelve una linea identica.
export function appendTaskId(line: string, taskId: string): string {
	const withoutId = line.replace(TASK_ID_REGEX, "").trimEnd();
	const boundary = findTasksMetadataStart(withoutId);
	const before = withoutId.slice(0, boundary).trimEnd();
	const metadata = withoutId.slice(boundary).trim();
	const idToken = `[tt-id:: ${taskId}]`;
	return metadata.length > 0 ? `${before} ${idToken} ${metadata}` : `${before} ${idToken}`;
}

// Punto de entrada compartido por los sitios que empiezan a trackear una
// tarea: reutiliza el tt-id si ya existia (recolocandolo si hacia falta) o
// genera uno nuevo. `updatedLine === line` cuando no hizo falta ningun
// cambio, para que el llamador evite escribir en la nota sin necesidad.
export function ensureTaskId(line: string): { taskId: string; updatedLine: string } {
	const taskId = extractTaskId(line) ?? generateTaskId();
	return { taskId, updatedLine: appendTaskId(line, taskId) };
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

export interface FixMisplacedTaskIdsResult {
	reviewed: number;
	fixed: number;
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

	// Fix pendiente de la pieza 1 — al detener el tracking (comando,
	// RecoveryModal, control inline o auto-stop al cerrar el checkbox), se
	// aprovecha ese mismo punto para recolocar el tt-id si quedo mal
	// puesto mientras la tarea estaba en marcha (p.ej. el usuario edito la
	// linea a mano). Misma logica de appendTaskId() ya verificada en la
	// pieza 1, sin nada nuevo: esta funcion solo decide DONDE escribir el
	// resultado. Si la nota esta abierta, escribe via el Editor en vivo
	// (evita que esa vista se desincronice de un vault.process() por
	// detras, mismo motivo que ya gobierna searchFiles() de arriba); si
	// no, cae a vault.process() (atomico, igual que fixMisplacedTaskIds()).
	async repositionTaskId(taskId: string): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) continue;
			const { editor } = leaf.view;
			for (let lineNumber = 0; lineNumber < editor.lineCount(); lineNumber++) {
				const lineText = editor.getLine(lineNumber);
				if (extractTaskId(lineText) !== taskId) continue;
				const updated = appendTaskId(lineText, taskId);
				if (updated !== lineText) editor.setLine(lineNumber, updated);
				return;
			}
		}

		const resolved = await this.resolve(taskId);
		if (!resolved) return;
		const file = this.app.vault.getAbstractFileByPath(resolved.filePath);
		if (!(file instanceof TFile)) return;

		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const lineText = lines[i];
				if (lineText === undefined || extractTaskId(lineText) !== taskId) continue;
				const updated = appendTaskId(lineText, taskId);
				if (updated === lineText) return data;
				lines[i] = updated;
				return lines.join("\n");
			}
			return data;
		});
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

	// Boton "Actualizar tareas" en Settings — corrige de una vez las tareas
	// trackeadas con una version anterior del plugin, que pudieron quedar
	// con el tt-id detras de los metadatos de Tasks (ver appendTaskId()).
	// Reutiliza esa misma logica ya verificada, sin ningun algoritmo nuevo.
	// Primero se comprueba con cachedRead() si una nota necesita algun
	// cambio antes de tocarla: asi las notas ya correctas no se escriben
	// nunca (ni un vault.process() de mas), acorde a "la vault del usuario
	// es su casa". Solo las que de verdad lo necesitan se reescriben, y
	// siempre con vault.process() (atomico, evita pisar una edicion
	// simultanea del usuario o de otro plugin sobre la misma nota).
	async fixMisplacedTaskIds(): Promise<FixMisplacedTaskIdsResult> {
		let reviewed = 0;
		let fixed = 0;

		for (const file of this.app.vault.getMarkdownFiles()) {
			const content = await this.app.vault.cachedRead(file);
			if (!content.includes("[tt-id::")) continue;

			let needsFix = false;
			for (const line of content.split("\n")) {
				const taskId = extractTaskId(line);
				if (!taskId) continue;
				reviewed++;
				if (appendTaskId(line, taskId) !== line) needsFix = true;
			}
			if (!needsFix) continue;

			await this.app.vault.process(file, (data) => {
				const lines = data.split("\n");
				for (let i = 0; i < lines.length; i++) {
					const lineText = lines[i];
					if (lineText === undefined) continue;
					const taskId = extractTaskId(lineText);
					if (!taskId) continue;
					const updated = appendTaskId(lineText, taskId);
					if (updated !== lineText) {
						lines[i] = updated;
						fixed++;
					}
				}
				return lines.join("\n");
			});
		}

		return { reviewed, fixed };
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
