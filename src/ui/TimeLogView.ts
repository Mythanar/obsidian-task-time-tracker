// ui/TimeLogView.ts
// Fase 1 — MVP de tracking local (panel de historial basico).
// Fase 2 — cada entrada se resuelve por su tt-id::; si la linea ya no
// existe en ninguna nota, se muestra como "Tarea no encontrada" sin
// descartar el historico.
// Fase 5 UX — rediseno: las tarjetas de "Total acumulado por tarea" son
// expandibles (muestran sus sesiones individuales dentro, ya no hay un
// bloque cronologico aparte), el titulo abre la nota de origen, y cada
// sesion cerrada se puede editar (fecha/hora) o borrar haciendo clic en
// toda la fila (sin icono aparte).

import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { parseCheckboxLine, ResolvedTask, TaskIdentifier } from "../core/TaskIdentifier";
import { DeleteTaskResult, EntryUpdateResult, TimeEntry } from "../types";

export const TIME_LOG_VIEW_TYPE = "task-time-tracker-log-view";

export interface TimeLogViewActions {
	updateEntryTimes(entryId: string, start: number, end: number): Promise<EntryUpdateResult>;
	deleteEntry(entryId: string): Promise<void>;
	deleteTask(taskId: string): Promise<DeleteTaskResult>;
}

// Estado transitorio de edicion de una sesion: solo una a la vez, nunca
// se persiste. Un clic fuera de la fila no la descarta (solo Guardar/
// Cancelar/Eliminar lo hacen) — ver renderSessionRow()/renderEditForm().
// Fecha y horas son campos de texto simples ("YYYY-MM-DD"/"HH:MM:SS"):
// el usuario controla los segundos por completo, como cualquier otro
// campo — no hay ninguna regla especial que los fuerce a :00. No hay
// campo de fecha de fin — se calcula sola (ver resolveDraftTimestamps()).
// Si se cancela, la sesion original queda intacta.
// startTimeEvaluated/endTimeEvaluated: si ese campo de hora ya paso por
// blur o alcanzo longitud completa al menos una vez desde el ultimo
// cambio (ver renderEditForm/bindTimeInput) — mientras no sea asi, un
// formato invalido no se muestra todavia (el usuario sigue escribiendo).
// Se guardan en el draft (no solo como clase CSS en el input) porque el
// formulario se puede reconstruir entero por un refresh externo sin que
// el usuario haya tocado nada (ver punto B: clic fuera no descarta).
interface EditDraft {
	entryId: string;
	startDate: string;
	startTime: string;
	startTimeEvaluated: boolean;
	endTime: string;
	endTimeEvaluated: boolean;
	error: string | null;
	confirmingDelete: boolean;
}

interface ParsedTime {
	hours: number;
	minutes: number;
	seconds: number;
}

const TIME_INPUT_REGEX = /^([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
const DATE_INPUT_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function formatDateInput(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "HH:MM:SS" en hora local (ver EditDraft).
function formatHMS(ms: number): string {
	const d = new Date(ms);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseTimeInput(value: string): ParsedTime | null {
	const match = value.trim().match(TIME_INPUT_REGEX);
	if (!match) return null;
	return { hours: Number(match[1]), minutes: Number(match[2]), seconds: Number(match[3]) };
}

// Devuelve la medianoche local de esa fecha, o null si el campo no tiene
// el formato "YYYY-MM-DD" que produce <input type="date">.
function parseDateInput(value: string): number | null {
	const match = value.match(DATE_INPUT_REGEX);
	if (!match) return null;
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

function addDays(dateAtMidnightMs: number, days: number): number {
	const d = new Date(dateAtMidnightMs);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0).getTime();
}

// Bloque 2 — navegacion por fecha del Historial (dia/semana). Todo el
// filtrado usa el dia calendario LOCAL de entry.start (no de entry.end):
// una sesion se cuenta en el dia en que empezo, aunque cruce medianoche.
function startOfDay(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

// Semana de lunes a domingo (convencion ISO), a partir de cualquier
// fecha dentro de ella.
function startOfWeek(ms: number): number {
	const dayStart = startOfDay(ms);
	const weekday = new Date(dayStart).getDay(); // 0 = domingo ... 6 = sabado
	const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
	return addDays(dayStart, diffToMonday);
}

function isSameLocalDay(ms: number, dayStartMs: number): boolean {
	return startOfDay(ms) === dayStartMs;
}

type LogViewMode = "day" | "week";

function combineDateAndTime(dateAtMidnightMs: number, time: ParsedTime): number {
	const d = new Date(dateAtMidnightMs);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), time.hours, time.minutes, time.seconds, 0).getTime();
}

// Para sesiones ya guardadas (no en edicion): compara el dia calendario
// local de inicio y fin para decidir si mostrar el indicador "+1".
function crossesMidnightRange(startMs: number, endMs: number): boolean {
	const s = new Date(startMs);
	const e = new Date(endMs);
	return s.getFullYear() !== e.getFullYear() || s.getMonth() !== e.getMonth() || s.getDate() !== e.getDate();
}

// Dos rangos [start, end) se solapan si cada uno empieza antes de que
// el otro termine. Una sesion activa (sin end) se trata como si
// terminara "ahora" a estos efectos — igual que hacia main.ts antes de
// que este aviso pasara a calcularse en vivo aqui en vez de al guardar.
function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
	return startA < endB && startB < endA;
}

type DraftResolution =
	| { ok: true; start: number; end: number; crossesMidnight: boolean }
	| { ok: false; error: string };

const INVALID_FORMAT_ERROR = "Revisa la fecha y las horas: usa el formato HH:MM:SS.";

// Resuelve el rango final a partir de los tres campos del borrador, tal
// cual los dejo el usuario (segundos incluidos, sin forzar nada). El fin
// cae al dia siguiente de la fecha de inicio si su hora (con segundos)
// es estrictamente menor que la de inicio.
function resolveDraftTimestamps(draft: EditDraft): DraftResolution {
	const startDateMs = parseDateInput(draft.startDate);
	const start = parseTimeInput(draft.startTime);
	const end = parseTimeInput(draft.endTime);
	if (startDateMs === null || !start || !end) return { ok: false, error: INVALID_FORMAT_ERROR };

	const secondsOfDay = (t: ParsedTime) => t.hours * 3600 + t.minutes * 60 + t.seconds;
	const crossesMidnight = secondsOfDay(end) < secondsOfDay(start);
	const endDateMs = crossesMidnight ? addDays(startDateMs, 1) : startDateMs;

	return {
		ok: true,
		start: combineDateAndTime(startDateMs, start),
		end: combineDateAndTime(endDateMs, end),
		crossesMidnight,
	};
}

export class TimeLogView extends ItemView {
	// Claves de expandedTaskIds son "<dia>|<taskId>" (no solo taskId): en
	// vista semanal la misma tarea puede tener sesiones en varios dias, cada
	// uno con su propia tarjeta, y deben poder expandirse de forma
	// independiente.
	private expandedTaskIds = new Set<string>();
	private editDraft: EditDraft | null = null;
	// Backlog Fase 5 — borrado de tarea completa (todo su historico por
	// tt-id): confirmacion pendiente, si hay alguna. Se guarda por taskId,
	// no por tarjeta/dia: si la misma tarea aparece en varias tarjetas
	// (vista semanal), la confirmacion se refleja en todas a la vez, ya
	// que la accion afecta al historico completo, no a una sola tarjeta.
	private taskDeleteConfirmId: string | null = null;
	// Bloque 2 — cada apertura del panel (instancia nueva de la vista, ver
	// registerView en main.ts) arranca siempre en "hoy" y en vista diaria;
	// no hay memoria de la ultima fecha/modo vistos en una apertura anterior.
	private viewMode: LogViewMode = "day";
	private anchorDate: number = startOfDay(Date.now());

	constructor(
		leaf: WorkspaceLeaf,
		private getEntries: () => TimeEntry[],
		private taskIdentifier: TaskIdentifier,
		private actions: TimeLogViewActions,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TIME_LOG_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Time tracker log";
	}

	getIcon(): string {
		return "clock";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	refresh(): void {
		void this.render();
	}

	private async resolveTaskIds(entries: TimeEntry[]): Promise<Map<string, ResolvedTask | null>> {
		const uniqueIds = [...new Set(entries.map((entry) => entry.taskId))];
		const resolutions = new Map<string, ResolvedTask | null>();
		for (const taskId of uniqueIds) {
			resolutions.set(taskId, await this.taskIdentifier.resolve(taskId));
		}
		return resolutions;
	}

	private taskLabel(taskId: string, resolutions: Map<string, ResolvedTask | null>): string {
		const resolved = resolutions.get(taskId) ?? null;
		if (!resolved) return "Tarea no encontrada";
		return parseCheckboxLine(resolved.lineText) ?? resolved.lineText;
	}

	// Agrupa por tt-id preservando el orden de aparicion en `entries` (ya
	// viene ordenado por fecha de inicio descendente desde render()), asi
	// que cada tarea queda ordenada por la fecha de su sesion mas reciente.
	private groupByTaskId(entries: TimeEntry[]): Map<string, TimeEntry[]> {
		const grouped = new Map<string, TimeEntry[]>();
		for (const entry of entries) {
			const bucket = grouped.get(entry.taskId);
			if (bucket) bucket.push(entry);
			else grouped.set(entry.taskId, [entry]);
		}
		return grouped;
	}

	// Bloque 2 — dayKey identifica el dia (calendario local) al que
	// pertenecen estas tarjetas (ver renderDaySection()); solo se usa para
	// dar a cada tarjeta una clave de expansion propia, no filtra nada aqui
	// (las entries ya llegan acotadas al rango de fecha visible).
	private renderTaskList(
		container: Element,
		entries: TimeEntry[],
		resolutions: Map<string, ResolvedTask | null>,
		dayKey: number,
	): void {
		const list = container.createDiv({ cls: "task-time-tracker-log-list" });

		for (const [taskId, taskEntries] of this.groupByTaskId(entries)) {
			this.renderTaskCard(list, taskId, taskEntries, resolutions, dayKey);
		}
	}

	// Orden de la cabecera: 1) titulo (con link a la nota si se resuelve),
	// 2) linea de meta (sesiones + total + tt-id), 3) detalle expandido.
	// El total (totalMs) es el de taskEntries tal cual llega: acotado al
	// rango de fecha visible (dia o semana), a proposito distinto del total
	// historico completo que muestra el badge junto al checkbox (Fase 5).
	private renderTaskCard(
		list: Element,
		taskId: string,
		taskEntries: TimeEntry[],
		resolutions: Map<string, ResolvedTask | null>,
		dayKey: number,
	): void {
		const label = this.taskLabel(taskId, resolutions);

		// Backlog Fase 5 — confirmacion de borrado de tarea completa: sale
		// del flujo normal de la tarjeta (sin cabecera expandible ni
		// detalle), igual que confirmingDelete lo hace para una sesion
		// individual — ver renderTaskDeleteConfirm().
		if (this.taskDeleteConfirmId === taskId) {
			const card = list.createDiv({ cls: "task-time-tracker-log-row" });
			this.renderTaskDeleteConfirm(card, taskId, label);
			return;
		}

		const expandKey = `${dayKey}|${taskId}`;
		const totalMs = taskEntries.reduce((sum, entry) => sum + ((entry.end ?? Date.now()) - entry.start), 0);
		const isMissing = resolutions.get(taskId) == null;
		const expanded = this.expandedTaskIds.has(expandKey);

		const card = list.createDiv({ cls: "task-time-tracker-log-row" });
		const header = card.createDiv({ cls: "task-time-tracker-log-card-header" });

		// Linea 1: solo el enlace a la nota de origen (o el texto si la tarea
		// no se resuelve). Ninguna accion de expandir/colapsar vive aqui, asi
		// que el chevron se movio a la linea 2 — ver comentario ahi.
		const titleRow = header.createDiv({ cls: "task-time-tracker-log-card-title-row" });
		const title = titleRow.createDiv({ text: label, cls: "task-time-tracker-log-task" });
		if (isMissing) {
			title.addClass("task-time-tracker-log-task-missing");
		} else {
			title.addClass("task-time-tracker-log-task-link");
			title.addEventListener("click", () => {
				void this.openTaskNote(taskId, taskEntries);
			});
		}

		if (isMissing) {
			const mostRecent = taskEntries.reduce((latest, entry) => (entry.start > latest.start ? entry : latest));
			header.createDiv({ text: mostRecent.taskText, cls: "task-time-tracker-log-task-snapshot" });
		}

		// Linea 2: chevron + nº sesiones + total + tt-id. Unico disparador de
		// expandir/colapsar la tarjeta (antes compartia el clic con toda la
		// cabecera, incluido el titulo) — con el mismo estilo de hover que ya
		// usan las filas de sesion individuales, para marcarla como clicable.
		const meta = header.createDiv({ cls: "task-time-tracker-log-meta task-time-tracker-log-meta-toggle" });
		const toggleIcon = meta.createSpan({ cls: "task-time-tracker-log-card-toggle" });
		setIcon(toggleIcon, expanded ? "chevron-down" : "chevron-right");
		meta.createSpan({ text: `${taskEntries.length} ${taskEntries.length === 1 ? "sesión" : "sesiones"}` });
		meta.createSpan({ text: formatDuration(totalMs), cls: "task-time-tracker-totals-duration" });
		meta.createSpan({ text: taskId, cls: "task-time-tracker-log-taskid" });

		meta.addEventListener("click", () => {
			if (expanded) this.expandedTaskIds.delete(expandKey);
			else this.expandedTaskIds.add(expandKey);
			void this.render();
		});

		// Backlog Fase 5 — borrar la tarea completa (todo su historico, no
		// solo lo visible en el rango de fecha actual): con stopPropagation
		// para no disparar tambien el expandir/colapsar de la fila que lo
		// contiene. El chequeo de sesion activa usa this.getEntries() sin
		// acotar por dia/semana — la tarea puede tener su sesion activa hoy
		// aunque esta tarjeta en concreto muestre otro dia (vista semanal).
		const deleteBtn = meta.createEl("button", { cls: "task-time-tracker-log-card-delete clickable-icon" });
		setIcon(deleteBtn, "trash-2");
		deleteBtn.setAttribute("aria-label", "Eliminar tarea");
		deleteBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			const hasActive = this.getEntries().some((entry) => entry.taskId === taskId && entry.end === null);
			if (hasActive) {
				new Notice("No se puede eliminar: esta tarea tiene una sesión activa. Detén el tracking primero.");
				return;
			}
			this.taskDeleteConfirmId = taskId;
			void this.render();
		});

		if (expanded) {
			const detail = card.createDiv({ cls: "task-time-tracker-log-card-detail" });
			for (const entry of taskEntries) {
				this.renderSessionRow(detail, entry);
			}
		}
	}

	// Backlog Fase 5 — confirmacion de borrado de tarea completa. Mismo
	// patron que renderEditForm() usa para confirmar el borrado de una
	// sesion individual (datos visibles + Si/Cancelar), reutilizando las
	// mismas clases CSS. A diferencia de la tarjeta normal (cuyo total
	// puede venir acotado a un dia/semana), aqui se recalculan sesiones y
	// total SIEMPRE sobre el historico completo de la tarea
	// (this.getEntries() sin filtrar por fecha): lo que se muestra debe
	// coincidir exactamente con lo que se va a borrar.
	// Orden de arriba a abajo: titulo, resumen, aviso, botones (todo junto,
	// sin scroll, para decidir y confirmar) y, tras una linea divisoria, el
	// detalle completo de todas las sesiones — mismo renderSessionRow() que
	// ya se usa al expandir la tarjeta en el uso normal del Historial.
	private renderTaskDeleteConfirm(card: Element, taskId: string, label: string): void {
		const fullTaskEntries = this.getEntries().filter((entry) => entry.taskId === taskId);
		const totalMs = fullTaskEntries.reduce((sum, entry) => sum + ((entry.end ?? Date.now()) - entry.start), 0);

		const confirm = card.createDiv({ cls: "task-time-tracker-log-edit-form" });
		confirm.createDiv({ text: label, cls: "task-time-tracker-log-task" });

		const meta = confirm.createDiv({ cls: "task-time-tracker-log-meta" });
		meta.createSpan({ text: `${fullTaskEntries.length} ${fullTaskEntries.length === 1 ? "sesión" : "sesiones"}` });
		meta.createSpan({ text: formatDuration(totalMs), cls: "task-time-tracker-totals-duration" });
		meta.createSpan({ text: taskId, cls: "task-time-tracker-log-taskid" });

		confirm.createEl("p", {
			text: "¿Eliminar esta tarea y todo su histórico de sesiones (todas las fechas)? Esta acción no se puede deshacer.",
			cls: "task-time-tracker-log-edit-error",
		});

		const actions = confirm.createDiv({ cls: "task-time-tracker-log-edit-actions" });
		actions.createEl("button", { text: "Sí, eliminar", cls: "mod-warning" }).addEventListener("click", () => {
			void this.actions.deleteTask(taskId).then((result) => {
				if (!result.ok) {
					new Notice("No se puede eliminar: esta tarea tiene una sesión activa. Detén el tracking primero.");
				}
				this.taskDeleteConfirmId = null;
				void this.render();
			});
		});
		actions.createEl("button", { text: "Cancelar" }).addEventListener("click", () => {
			this.taskDeleteConfirmId = null;
			void this.render();
		});

		// Solo lectura a proposito: renderSessionRow() (uso normal del
		// Historial) deja la fila clicable para editar y añade su propio
		// boton "Eliminar" por sesion — dos acciones de escritura que no
		// deben convivir con la confirmacion de borrar la tarea entera. Aqui
		// se llama renderSessionInfo() directamente (mismos datos: fecha,
		// hora inicio, hora fin, duracion), sin listener de clic ni botones.
		const detail = confirm.createDiv({ cls: "task-time-tracker-log-card-detail" });
		for (const entry of [...fullTaskEntries].sort((a, b) => b.start - a.start)) {
			const row = detail.createDiv({ cls: "task-time-tracker-log-session-row" });
			this.renderSessionInfo(row, entry);
		}
	}

	// Fecha + hora inicio + hora fin (con indicador "+1" si cruza
	// medianoche) + duracion. Comun a la fila normal de una sesion y al
	// aviso de confirmacion de borrado (para que los datos de la sesion
	// sigan visibles mientras se confirma).
	private renderSessionInfo(container: Element, entry: TimeEntry): void {
		const info = container.createDiv({ cls: "task-time-tracker-log-session-info" });
		const startDate = new Date(entry.start);
		info.createSpan({ text: startDate.toLocaleDateString() });

		const rangeSpan = info.createSpan();
		rangeSpan.createSpan({ text: startDate.toLocaleTimeString() });
		rangeSpan.createSpan({ text: " → " });
		if (entry.end !== null) {
			rangeSpan.createSpan({ text: new Date(entry.end).toLocaleTimeString() });
			if (crossesMidnightRange(entry.start, entry.end)) {
				rangeSpan.createSpan({ text: " +1", cls: "task-time-tracker-log-nextday-badge" });
			}
		} else {
			rangeSpan.createSpan({ text: "en curso" });
		}

		info.createSpan({ text: entry.end !== null ? formatDuration(entry.end - entry.start) : "—" });
	}

	private renderSessionRow(container: Element, entry: TimeEntry): void {
		if (this.editDraft?.entryId === entry.id) {
			this.renderEditForm(container, entry);
			return;
		}

		const row = container.createDiv({ cls: "task-time-tracker-log-session-row" });
		this.renderSessionInfo(row, entry);

		// Solo sesiones cerradas son editables: la activa (si la tarea
		// tuviera una en curso) nunca se edita desde aqui. Punto D2 del
		// rediseno: toda la fila es clicable (fondo en hover via CSS), ya
		// no hay un icono de editar aparte.
		if (entry.end !== null) {
			row.addClass("task-time-tracker-log-session-row-editable");
			row.addEventListener("click", () => {
				this.editDraft = {
					entryId: entry.id,
					startDate: formatDateInput(entry.start),
					startTime: formatHMS(entry.start),
					startTimeEvaluated: false,
					endTime: formatHMS(entry.end as number),
					endTimeEvaluated: false,
					error: null,
					confirmingDelete: false,
				};
				void this.render();
			});
		}
	}

	private renderEditForm(container: Element, entry: TimeEntry): void {
		const draft = this.editDraft;
		if (!draft) return;

		const form = container.createDiv({ cls: "task-time-tracker-log-edit-form" });

		if (draft.confirmingDelete) {
			// Los datos de la sesion (originales, no lo que se haya
			// tecleado sin guardar) siguen visibles mientras se confirma.
			this.renderSessionInfo(form, entry);
			form.createEl("p", {
				text: "¿Eliminar esta sesión? Esta acción no se puede deshacer.",
				cls: "task-time-tracker-log-edit-error",
			});
			const actions = form.createDiv({ cls: "task-time-tracker-log-edit-actions" });
			actions.createEl("button", { text: "Sí, eliminar", cls: "mod-warning" }).addEventListener("click", () => {
				void this.actions.deleteEntry(entry.id).then(() => {
					this.editDraft = null;
					void this.render();
				});
			});
			actions.createEl("button", { text: "Cancelar" }).addEventListener("click", () => {
				draft.confirmingDelete = false;
				void this.render();
			});
			return;
		}

		// Solo los campos de fecha/hora (sin botones: ver mas abajo, ahora
		// van en su propia fila para dejar sitio al bloque de aviso fijo
		// entre ambos).
		const fields = form.createDiv({ cls: "task-time-tracker-log-edit-fields" });

		const dateInput = fields.createEl("input", { cls: "task-time-tracker-log-edit-input" });
		dateInput.type = "date";
		dateInput.value = draft.startDate;

		const startInput = fields.createEl("input", { cls: "task-time-tracker-log-edit-input task-time-tracker-log-edit-time" });
		startInput.type = "text";
		startInput.placeholder = "HH:MM:SS";
		startInput.value = draft.startTime;

		fields.createSpan({ text: "→", cls: "task-time-tracker-log-edit-arrow" });

		const endInput = fields.createEl("input", { cls: "task-time-tracker-log-edit-input task-time-tracker-log-edit-time" });
		endInput.type = "text";
		endInput.placeholder = "HH:MM:SS";
		endInput.value = draft.endTime;

		// El estado "invalido" se guarda en el draft (startTimeEvaluated/
		// endTimeEvaluated), no solo como clase CSS: un refresh externo
		// reconstruye este formulario entero (ver comentario en
		// EditDraft), y sin esto la marca visual se perderia aunque el
		// campo siguiera siendo invalido.
		startInput.toggleClass("is-invalid", draft.startTimeEvaluated && parseTimeInput(draft.startTime) === null);
		endInput.toggleClass("is-invalid", draft.endTimeEvaluated && parseTimeInput(draft.endTime) === null);

		const nextDayBadge = fields.createSpan({ text: "+1", cls: "task-time-tracker-log-nextday-badge is-hidden" });
		const durationPreview = fields.createSpan({ cls: "task-time-tracker-totals-duration" });

		// Bloque de aviso unico y fijo: siempre en la misma posicion
		// (debajo de los campos, encima de los botones), con altura
		// reservada aunque no haya nada que mostrar, para que el
		// formulario no salte de alto. Nunca muestra dos mensajes a la
		// vez — ver updateMessage() para la prioridad entre ellos.
		const messageEl = form.createEl("p", { cls: "task-time-tracker-log-edit-message" });

		const actions = form.createDiv({ cls: "task-time-tracker-log-edit-actions" });
		actions.createEl("button", { text: "Guardar", cls: "mod-cta" }).addEventListener("click", () => {
			void this.saveEditDraft(entry);
		});
		actions.createEl("button", { text: "Cancelar" }).addEventListener("click", () => {
			this.editDraft = null;
			void this.render();
		});
		actions.createEl("button", { text: "Eliminar", cls: "mod-warning" }).addEventListener("click", () => {
			draft.confirmingDelete = true;
			void this.render();
		});

		const setMessage = (text: string, kind: "error" | "warning" | "none") => {
			messageEl.setText(text);
			messageEl.toggleClass("task-time-tracker-log-edit-message-error", kind === "error");
			messageEl.toggleClass("task-time-tracker-log-edit-message-warning", kind === "warning");
		};

		// Prioridad, nunca dos a la vez: 1) error de guardado del backend
		// (sesion borrada mientras se editaba) 2) error de formato — solo
		// si algun campo de hora ya fue evaluado (blur o longitud
		// completa, ver bindTimeInput; nunca mientras se sigue
		// escribiendo) 3) fin <= inicio (una vez el formato es valido)
		// 4) aviso de solapamiento (solo con formato valido y fin >
		// inicio) 5) nada.
		const updateMessage = () => {
			if (draft.error) {
				setMessage(draft.error, "error");
				return;
			}
			const startInvalid = draft.startTimeEvaluated && parseTimeInput(draft.startTime) === null;
			const endInvalid = draft.endTimeEvaluated && parseTimeInput(draft.endTime) === null;
			if (parseDateInput(draft.startDate) === null || startInvalid || endInvalid) {
				setMessage(INVALID_FORMAT_ERROR, "error");
				return;
			}

			const resolved = resolveDraftTimestamps(draft);
			if (!resolved.ok) {
				// Formato todavia incompleto pero no marcado invalido
				// (el usuario sigue escribiendo) — sin mensaje todavia.
				setMessage("", "none");
				return;
			}
			if (resolved.end <= resolved.start) {
				setMessage("La hora de fin debe ser posterior a la de inicio.", "error");
				return;
			}

			// Los campos de hora no tienen milisegundos (HH:MM:SS), asi
			// que resolveDraftTimestamps() siempre reconstruye con :000
			// — eso por si solo ya puede diferir en hasta ~1s del
			// end-start real de la sesion guardada. Mientras un campo no
			// se haya tocado (su texto sigue siendo el mismo con el que
			// se abrio la edicion), se usa el timestamp real de la
			// sesion para ESA punta, no el reconstruido.
			const start = draft.startTime === formatHMS(entry.start) ? entry.start : resolved.start;
			const end = draft.endTime === formatHMS(entry.end as number) ? (entry.end as number) : resolved.end;
			const overlapping = this.getEntries().some(
				(other) => other.id !== entry.id && rangesOverlap(start, end, other.start, other.end ?? Date.now()),
			);
			setMessage(overlapping ? "Aviso: este horario se solapa con otra sesión guardada." : "", overlapping ? "warning" : "none");
		};

		// Vista previa en vivo de duracion + "+1" mientras se escribe,
		// sin reconstruir el formulario entero — eso perderia el foco
		// del input a mitad de tecleo. Sin duracion valida todavia
		// (campos incompletos o fuera de rango), no se muestra nada.
		// Ver el comentario dentro de updateMessage() sobre por que se
		// usa el timestamp real de la sesion para la punta no tocada.
		const updatePreview = () => {
			const resolved = resolveDraftTimestamps(draft);
			if (!resolved.ok) {
				nextDayBadge.addClass("is-hidden");
				durationPreview.setText("");
				return;
			}
			const start = draft.startTime === formatHMS(entry.start) ? entry.start : resolved.start;
			const end = draft.endTime === formatHMS(entry.end as number) ? (entry.end as number) : resolved.end;
			nextDayBadge.toggleClass("is-hidden", !resolved.crossesMidnight);
			durationPreview.setText(end > start ? formatDuration(end - start) : "");
		};

		// Minutos/segundos y horas reales (ver TIME_INPUT_REGEX). El
		// error de formato NO se evalua en cada tecla (seria prematuro
		// mientras el usuario sigue escribiendo): solo al perder el foco
		// (blur) o al llegar a la longitud completa de "HH:MM:SS" (8
		// caracteres) — ver EditDraft sobre por que el resultado se
		// guarda en el draft (setEvaluated) y no solo como clase CSS.
		// Mientras tanto, se limpia para no dejar una marca vieja mientras
		// se sigue corrigiendo. Sin flechas arriba/abajo: se edita solo a
		// mano. Los segundos son libres — el usuario decide, sin ninguna
		// regla que los fuerce a :00.
		const bindTimeInput = (input: HTMLInputElement, apply: (value: string) => void, setEvaluated: (value: boolean) => void) => {
			const evaluateFormat = () => {
				setEvaluated(true);
				input.toggleClass("is-invalid", parseTimeInput(input.value) === null);
				updateMessage();
			};
			input.addEventListener("input", () => {
				apply(input.value);
				updatePreview();
				if (input.value.length >= 8) evaluateFormat();
				else {
					setEvaluated(false);
					input.removeClass("is-invalid");
					updateMessage();
				}
			});
			input.addEventListener("blur", evaluateFormat);
		};

		dateInput.addEventListener("input", () => {
			draft.startDate = dateInput.value;
			updatePreview();
			updateMessage();
		});
		bindTimeInput(
			startInput,
			(value) => (draft.startTime = value),
			(value) => (draft.startTimeEvaluated = value),
		);
		bindTimeInput(
			endInput,
			(value) => (draft.endTime = value),
			(value) => (draft.endTimeEvaluated = value),
		);

		updatePreview();
		updateMessage();
	}

	// Fin debe ser posterior a inicio, aplicada la logica de cruce de
	// medianoche (ver resolveDraftTimestamps). El solapamiento con otra
	// sesion ya se avisa en vivo mientras se edita (ver updateMessage());
	// aqui no se vuelve a comprobar, nunca bloquea el guardado.
	private async saveEditDraft(entry: TimeEntry): Promise<void> {
		const draft = this.editDraft;
		if (!draft) return;

		const resolved = resolveDraftTimestamps(draft);
		if (!resolved.ok) {
			draft.error = resolved.error;
			void this.render();
			return;
		}
		if (resolved.end <= resolved.start) {
			draft.error = "La hora de fin debe ser posterior a la de inicio.";
			void this.render();
			return;
		}

		const result = await this.actions.updateEntryTimes(entry.id, resolved.start, resolved.end);
		if (!result.ok) {
			draft.error =
				result.error === "invalid-range"
					? "La hora de fin debe ser posterior a la de inicio."
					: "No se pudo guardar: la sesión ya no existe.";
			void this.render();
			return;
		}

		this.editDraft = null;
		void this.render();
	}

	// Fase 5 UX — abre la nota de origen de una tarea desde el titulo de
	// su tarjeta (resolvePreferring: prioriza la nota de la sesion mas
	// reciente si el id esta duplicado en varias notas, con el criterio
	// generico de Fase 2 como respaldo). Si la nota ya esta abierta en
	// alguna pestaña del workspace, se enfoca esa (la primera que se
	// encuentre, sin importar cual sea "la mas reciente" entre varias) en
	// vez de abrir una pestaña nueva; si no, se abre una pestaña nueva en
	// el area central, igual que antes. Selecciona la linea completa unos
	// instantes a modo de resaltado (no hay una API publica para el flash
	// de la busqueda nativa de Obsidian sin tocar el DOM interno).
	private async openTaskNote(taskId: string, taskEntries: TimeEntry[]): Promise<void> {
		const mostRecent = taskEntries.reduce((latest, entry) => (entry.start > latest.start ? entry : latest));
		const resolved = await this.taskIdentifier.resolvePreferring(taskId, mostRecent.filePath);
		const file = resolved ? this.app.vault.getAbstractFileByPath(resolved.filePath) : null;
		if (!resolved || !(file instanceof TFile)) {
			new Notice("No se encontró ninguna nota con esta tarea.");
			return;
		}

		const leaf = this.findLeafWithFile(file) ?? this.app.workspace.getLeaf("tab");
		await leaf.openFile(file, { eState: { line: resolved.lineNumber } });
		await this.app.workspace.revealLeaf(leaf);

		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const editor = view.editor;
		const lineLength = editor.getLine(resolved.lineNumber)?.length ?? 0;
		const lineStart = { line: resolved.lineNumber, ch: 0 };
		editor.setSelection(lineStart, { line: resolved.lineNumber, ch: lineLength });
		editor.scrollIntoView({ from: lineStart, to: lineStart }, true);
		window.setTimeout(() => editor.setCursor(lineStart), 1200);
	}

	// Primera pestaña de markdown existente que ya tenga este archivo
	// abierto, o null si no hay ninguna. No distingue "la mas reciente"
	// entre varias — basta con la primera que se encuentre.
	private findLeafWithFile(file: TFile): WorkspaceLeaf | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
				return leaf;
			}
		}
		return null;
	}

	// Bloque 2 — barra de navegacion de fecha: toggle dia/semana, flechas
	// prev/siguiente (avanzan un dia o una semana segun el modo activo) y
	// boton "Hoy" (vuelve siempre al dia de hoy, incluso en vista semanal:
	// startOfDay(Date.now()) cae dentro de la semana de hoy).
	private renderDateNav(container: Element): void {
		const nav = container.createDiv({ cls: "task-time-tracker-log-datenav" });

		const modeToggle = nav.createDiv({ cls: "task-time-tracker-log-datenav-mode" });
		const dayBtn = modeToggle.createEl("button", {
			text: "Día",
			cls: "task-time-tracker-log-datenav-mode-btn",
		});
		const weekBtn = modeToggle.createEl("button", {
			text: "Semana",
			cls: "task-time-tracker-log-datenav-mode-btn",
		});
		dayBtn.toggleClass("is-active", this.viewMode === "day");
		weekBtn.toggleClass("is-active", this.viewMode === "week");
		dayBtn.addEventListener("click", () => {
			if (this.viewMode === "day") return;
			this.viewMode = "day";
			void this.render();
		});
		weekBtn.addEventListener("click", () => {
			if (this.viewMode === "week") return;
			this.viewMode = "week";
			void this.render();
		});

		const range = nav.createDiv({ cls: "task-time-tracker-log-datenav-range" });
		const prevBtn = range.createEl("button", { cls: "clickable-icon" });
		setIcon(prevBtn, "chevron-left");
		prevBtn.addEventListener("click", () => {
			this.anchorDate = addDays(this.anchorDate, this.viewMode === "day" ? -1 : -7);
			void this.render();
		});

		range.createSpan({ text: this.formatRangeLabel(), cls: "task-time-tracker-log-datenav-label" });

		const nextBtn = range.createEl("button", { cls: "clickable-icon" });
		setIcon(nextBtn, "chevron-right");
		nextBtn.addEventListener("click", () => {
			this.anchorDate = addDays(this.anchorDate, this.viewMode === "day" ? 1 : 7);
			void this.render();
		});

		const todayBtn = nav.createEl("button", { text: "Hoy" });
		todayBtn.addEventListener("click", () => {
			this.anchorDate = startOfDay(Date.now());
			void this.render();
		});
	}

	private formatRangeLabel(): string {
		if (this.viewMode === "day") {
			return new Date(this.anchorDate).toLocaleDateString(undefined, {
				weekday: "long",
				day: "numeric",
				month: "long",
				year: "numeric",
			});
		}
		const weekStart = startOfWeek(this.anchorDate);
		const weekEnd = addDays(weekStart, 6);
		return `${new Date(weekStart).toLocaleDateString()} – ${new Date(weekEnd).toLocaleDateString()}`;
	}

	private formatDayHeading(dayStart: number): string {
		return new Date(dayStart).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
	}

	// Bloque 2 — una seccion por dia: filtra allEntries a las que empezaron
	// (entry.start) ese dia calendario local, y muestra un estado vacio
	// razonable si no hay ninguna. withHeading solo se usa en vista semanal
	// (7 secciones, una por dia); en vista diaria el titulo de la seccion ya
	// lo da la barra de navegacion, asi que no hace falta repetirlo.
	private async renderDaySection(
		container: Element,
		dayStart: number,
		allEntries: TimeEntry[],
		withHeading = false,
	): Promise<void> {
		const dayEntries = allEntries
			.filter((entry) => isSameLocalDay(entry.start, dayStart))
			.sort((a, b) => b.start - a.start);

		if (withHeading) {
			container.createEl("h6", { text: this.formatDayHeading(dayStart), cls: "task-time-tracker-log-day-heading" });
		}

		if (dayEntries.length === 0) {
			container.createEl("p", { text: "Sin sesiones este día.", cls: "task-time-tracker-log-empty-day" });
			return;
		}

		const resolutions = await this.resolveTaskIds(dayEntries);
		this.renderTaskList(container, dayEntries, resolutions, dayStart);
	}

	private async render(): Promise<void> {
		const container = this.containerEl.children[1];
		if (!container) return;

		const allEntries = this.getEntries();

		container.empty();
		container.createEl("h4", { text: "Historial de tracking" });

		if (allEntries.length === 0) {
			container.createEl("p", { text: "Todavía no hay sesiones registradas." });
			return;
		}

		this.renderDateNav(container);

		if (this.viewMode === "day") {
			await this.renderDaySection(container, startOfDay(this.anchorDate), allEntries);
		} else {
			const weekStart = startOfWeek(this.anchorDate);
			for (let i = 0; i < 7; i++) {
				await this.renderDaySection(container, addDays(weekStart, i), allEntries, true);
			}
		}
	}
}
