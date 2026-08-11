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

import { ItemView, MarkdownView, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { formatDuration, formatDurationCompact } from "../core/TrackingEngine";
import { parseCheckboxLine, ResolvedTask, TaskIdentifier } from "../core/TaskIdentifier";
import { t } from "../i18n";
import { DeleteTaskResult, EntryUpdateResult, TimeEntry } from "../types";
import { InlineTrackingBus } from "./InlineTrackingBus";

export const TIME_LOG_VIEW_TYPE = "task-time-tracker-log-view";

export interface TimeLogViewActions {
	updateEntryTimes(entryId: string, start: number, end: number): Promise<EntryUpdateResult>;
	deleteEntry(entryId: string): Promise<void>;
	deleteTask(taskId: string): Promise<DeleteTaskResult>;
	stopTracking(): Promise<void>;
	// Mismo bus que ya usa el badge junto al checkbox (ver
	// InlineTaskControlExtension.ts): notifica cada segundo mientras haya
	// una sesion activa, para que la tarjeta de esa tarea (si esta en el
	// rango de fecha visible) actualice su contador en vivo sin necesidad
	// de un render() completo del panel.
	bus: InlineTrackingBus;
}

// Estado transitorio de edicion de una sesion: solo una a la vez, nunca
// se persiste. Un clic fuera de la fila no la descarta (solo Guardar/
// Cancelar/Eliminar lo hacen) — ver renderSessionRow()/renderEditForm().
// Los cuatro campos (fecha inicio, hora inicio, fecha fin, hora fin) son
// campos de texto simples ("YYYY-MM-DD"/"HH:MM:SS"), incluida la fecha
// de fin: deja de inferirse por comparacion de horas (decision revisada
// respecto al diseno original de Bloque 1, que la calculaba sola) y pasa
// a ser un dato mas que el usuario controla directamente, igual que ya
// pasaba con los segundos de hora inicio/fin. Si se cancela, la sesion
// original queda intacta.
// {campo}Evaluated: si ese campo ya paso por blur o alcanzo longitud
// completa al menos una vez desde el ultimo cambio (ver
// renderEditForm/bindDraftField) — mientras no sea asi, un formato
// invalido no se muestra todavia (el usuario sigue escribiendo). Se
// guardan en el draft (no solo como clase CSS en el input) porque el
// formulario se puede reconstruir entero por un refresh externo sin que
// el usuario haya tocado nada (ver punto B: clic fuera no descarta).
interface EditDraft {
	entryId: string;
	startDate: string;
	startDateEvaluated: boolean;
	startTime: string;
	startTimeEvaluated: boolean;
	endDate: string;
	endDateEvaluated: boolean;
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

// Numero de dias naturales de diferencia entre la fecha (parte de
// fecha, sin hora) de startMs y la de endMs — para el badge "+N" de la
// fila de sesion estatica y de la confirmacion de borrado (unico sitio
// que sigue necesitandolo: el formulario de edicion tiene fecha de fin
// explicita y ya no infiere nada, ver resolveDraftTimestamps()). Ambas
// fechas se normalizan con Date.UTC(y, m, d) — no con resta directa de
// timestamps ni con dias * 86400000 en hora local — para que el
// resultado sea siempre un entero exacto incluso si el rango cruza un
// cambio de horario de verano/invierno entre esas dos fechas.
function getDaySpan(startMs: number, endMs: number): number {
	const s = new Date(startMs);
	const e = new Date(endMs);
	const startUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
	const endUtc = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
	return Math.round((endUtc - startUtc) / 86400000);
}

// Dos rangos [start, end) se solapan si cada uno empieza antes de que
// el otro termine. Una sesion activa (sin end) se trata como si
// terminara "ahora" a estos efectos — igual que hacia main.ts antes de
// que este aviso pasara a calcularse en vivo aqui en vez de al guardar.
function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
	return startA < endB && startB < endA;
}

type DraftResolution = { ok: true; start: number; end: number } | { ok: false; error: string };

// Resuelve el rango final a partir de los cuatro campos del borrador,
// tal cual los dejo el usuario (segundos incluidos, sin forzar nada).
// Fecha de fin y fecha de inicio son independientes: quien decide si la
// sesion cruza medianoche (o varios dias) es la propia fecha de fin
// tecleada, no una inferencia por comparacion de horas. (El campo
// "crossesMidnight" que llevaba este resultado — resto del mecanismo de
// inferencia anterior a que la fecha de fin fuera explicita — no lo leia
// nadie: el formulario de edicion ya no muestra el badge "+N", ver
// docs/DECISIONES.md.)
function resolveDraftTimestamps(draft: EditDraft): DraftResolution {
	const startDateMs = parseDateInput(draft.startDate);
	const endDateMs = parseDateInput(draft.endDate);
	const start = parseTimeInput(draft.startTime);
	const end = parseTimeInput(draft.endTime);
	if (startDateMs === null || endDateMs === null || !start || !end) {
		return { ok: false, error: t("log.errorFormat") };
	}

	return {
		ok: true,
		start: combineDateAndTime(startDateMs, start),
		end: combineDateAndTime(endDateMs, end),
	};
}

// Para la punta que no se ha tocado (su texto sigue siendo el mismo con
// el que se abrio la edicion, tanto fecha como hora), se usa el
// timestamp real de la sesion en vez del reconstruido por
// resolveDraftTimestamps() — evita cualquier diferencia de precision
// entre ambos calculos. Compartido por updateMessage() (solapamiento) y
// updatePreview() (duracion en vivo) para no duplicar el criterio.
function effectiveRange(draft: EditDraft, entry: TimeEntry, resolved: { start: number; end: number }) {
	const startUnchanged = draft.startDate === formatDateInput(entry.start) && draft.startTime === formatHMS(entry.start);
	const endUnchanged =
		draft.endDate === formatDateInput(entry.end as number) && draft.endTime === formatHMS(entry.end as number);
	return {
		start: startUnchanged ? entry.start : resolved.start,
		end: endUnchanged ? (entry.end as number) : resolved.end,
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
	// Elementos con contador en vivo de la tarea activa (si esta en el
	// rango de fecha visible tras el ultimo render()): se recalculan cada
	// segundo via el bus, sin reconstruir el panel entero. Puede haber mas
	// de uno a la vez — el boton de stop de la cabecera y, si la tarjeta
	// esta expandida, la fila de su sesion en curso dentro del detalle.
	// Vacio si la tarea con tracking activo no aparece en ningun elemento
	// actualmente renderizado.
	private activeCardTicks: Array<{ el: HTMLElement; completedMs: number; start: number }> = [];
	private busUnsubscribe: (() => void) | null = null;
	// render() es async (resolveTaskIds lee el vault) y puede dispararse
	// mas de una vez para la misma accion del usuario (p.ej. al guardar
	// una edicion: saveEditDraft() llama a render() explicitamente, y
	// main.ts ya dispara refreshLogViews() -> render() desde dentro de
	// updateEntryTimes()). Sin este guard, una llamada mas antigua que
	// se reanuda tras su propio await puede seguir aniadiendo tarjetas al
	// contenedor que una llamada mas reciente ya vacio y reconstruyo,
	// duplicando el contenido. Cada render() se queda con su propio
	// numero de turno al empezar; si al reanudar tras un await ese numero
	// ya no coincide con el mas reciente, se aborta sin tocar el DOM.
	private renderToken = 0;

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
		return t("log.title");
	}

	getIcon(): string {
		return "clock";
	}

	async onOpen(): Promise<void> {
		this.busUnsubscribe = this.actions.bus.subscribe(() => this.tickActiveCard());
		await this.render();
	}

	async onClose(): Promise<void> {
		this.busUnsubscribe?.();
		this.busUnsubscribe = null;
	}

	refresh(): void {
		void this.render();
	}

	private tickActiveCard(): void {
		for (const { el, completedMs, start } of this.activeCardTicks) {
			el.setText(formatDuration(completedMs + (Date.now() - start)));
		}
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
		if (!resolved) return t("log.taskNotFound");
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
		// La sesion activa, si es una de las entries de ESTA tarjeta (ya
		// acotadas al rango de fecha visible por renderDaySection()): al
		// haber un unico timer activo en todo el plugin, como mucho una
		// tarjeta en toda la vista puede cumplir esto. Si la tarea activa no
		// tiene ninguna sesion en el rango visible, activeEntry es null aqui
		// y la tarjeta se comporta exactamente igual que cualquier otra.
		const activeEntry = taskEntries.find((entry) => entry.end === null) ?? null;

		const card = list.createDiv({ cls: "task-time-tracker-log-row" });
		card.toggleClass("is-tracking-active", activeEntry !== null);
		// El trash de tarea se revela mientras la tarjeta esta expandida
		// (igual en desktop y mobile, ver styles.css) en vez de con
		// :hover/:focus-within: mostrar un icono destructivo como reaccion
		// pasiva al cursor invitaba a "aqui se borra" sin que el usuario
		// hubiera pedido nada.
		card.toggleClass("is-expanded", expanded);

		// Rediseno de interaccion: toda la cabecera (titulo + meta) abre/
		// cierra las sesiones; el icono de nota y el trash de tarea son las
		// unicas excepciones (stopPropagation en su click, mas abajo). El
		// titulo deja de ser un link — abrir la nota pasa a un icono propio
		// delante del texto.
		const header = card.createDiv({ cls: "task-time-tracker-log-card-header" });
		header.addEventListener("click", () => {
			if (expanded) this.expandedTaskIds.delete(expandKey);
			else this.expandedTaskIds.add(expandKey);
			void this.render();
		});

		// Columna de icono de ancho fijo (task-time-tracker-log-card-icon-col,
		// ver styles.css), repetida en las dos lineas de la cabecera —
		// nota en la linea 1, chevron en la linea 2 — para que el titulo y
		// "N sessions..." arranquen siempre en el mismo margen izquierdo,
		// tenga o no icono de nota esta tarea (isMissing). Se reserva
		// aunque no haya boton que renderizar dentro.
		const titleRow = header.createDiv({ cls: "task-time-tracker-log-card-title-row" });
		const noteCol = titleRow.createDiv({ cls: "task-time-tracker-log-card-icon-col" });
		if (!isMissing) {
			const noteBtn = noteCol.createEl("button", {
				cls: "task-time-tracker-log-card-note task-time-tracker-icon-btn clickable-icon",
			});
			setIcon(noteBtn, "file-text");
			noteBtn.setAttribute("aria-label", t("log.openNoteAriaLabel"));
			noteBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				void this.openTaskNote(taskId, taskEntries);
			});
		} else {
			// Tarea "no encontrada": mismo hueco (noteCol) y mismas clases
			// que el icono de nota normal, para no romper la alineacion del
			// titulo entre tarjetas — solo cambia el icono ("file-x", mismo
			// trazo/familia que "file-text") y la accion al clic, que ya no
			// puede abrir una nota que no existe.
			const missingBtn = noteCol.createEl("button", {
				cls: "task-time-tracker-log-card-note task-time-tracker-icon-btn clickable-icon",
			});
			setIcon(missingBtn, "file-x");
			missingBtn.setAttribute("aria-label", t("log.noteNotFoundAriaLabel"));
			missingBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				new Notice(t("notice.noteNotFound"));
			});
		}
		const title = titleRow.createDiv({ text: label, cls: "task-time-tracker-log-task" });
		if (isMissing) {
			title.addClass("task-time-tracker-log-task-missing");
		}

		if (isMissing) {
			const mostRecent = taskEntries.reduce((latest, entry) => (entry.start > latest.start ? entry : latest));
			header.createDiv({ text: mostRecent.taskText, cls: "task-time-tracker-log-task-snapshot" });
		}

		// Linea 2: chevron (decorativo, aria-hidden — el trigger real es
		// toda la cabecera, ver arriba) + nº sesiones + total + tt-id +
		// boton (trash o stop+contador). Un unico grupo flex-wrap (sin el
		// contenedor "summary" que antes separaba estos elementos del
		// boton): en mobile, con el panel mas estrecho que la pantalla,
		// cualquiera de estos elementos puede necesitar bajar de linea
		// entero (nunca partirse por dentro, ver white-space: nowrap en
		// styles.css) — incluido el badge de tracking activo, que antes
		// se desbordaba por no formar parte de este mismo flex-wrap.
		const meta = header.createDiv({ cls: "task-time-tracker-log-meta" });
		const toggleCol = meta.createDiv({ cls: "task-time-tracker-log-card-icon-col" });
		const toggleIcon = toggleCol.createSpan({ cls: "task-time-tracker-log-card-toggle" });
		toggleIcon.setAttribute("aria-hidden", "true");
		setIcon(toggleIcon, expanded ? "chevron-down" : "chevron-right");
		meta.createSpan({
			text: `${taskEntries.length} ${taskEntries.length === 1 ? t("log.session.singular") : t("log.session.plural")}`,
			cls: "task-time-tracker-log-session-count",
		});
		// Total agregado (varias sesiones sumadas): formato compacto, no
		// HH:MM:SS — ver formatDurationCompact(). Icono de cronometro +
		// valor agrupados (task-time-tracker-totals-duration-group) para
		// que el numero compita visualmente con el titulo en vez de
		// perderse entre el resto de metadatos de la cabecera (tt-id,
		// nº de sesiones) — mismo patron que el bloque "Calculated
		// duration" del formulario de edicion.
		const totalGroup = meta.createSpan({ cls: "task-time-tracker-totals-duration-group" });
		setIcon(totalGroup.createSpan({ cls: "task-time-tracker-totals-duration-icon" }), "timer");
		totalGroup.createSpan({ text: formatDurationCompact(totalMs), cls: "task-time-tracker-totals-duration" });
		meta.createSpan({ text: taskId, cls: "task-time-tracker-log-taskid" });

		if (activeEntry) {
			// Reemplaza la papelera (deshabilitada mientras la tarea esta
			// activa): boton de stop con contador en vivo, mismo patron de
			// pill que el badge junto al checkbox (icono relleno + numero en
			// monoespaciada). completedMs es la suma de las sesiones YA
			// cerradas de esta tarjeta; el tick de cada segundo (via el bus)
			// le suma el tiempo transcurrido desde activeEntry.start.
			const stopBtn = meta.createEl("button", { cls: "task-time-tracker-log-card-stop" });
			stopBtn.setAttribute("aria-label", t("log.stopTrackingAriaLabel"));
			const stopIcon = stopBtn.createSpan({ cls: "task-time-tracker-log-card-stop-icon" });
			setIcon(stopIcon, "square");
			// Mismo punto pulsante que el badge junto al checkbox (comparten
			// clase y animacion): aqui siempre "en ejecucion", sin necesidad
			// de una clase is-active propia.
			stopBtn.createSpan({ cls: "task-time-tracker-inline-dot" });
			const stopDuration = stopBtn.createSpan({ cls: "task-time-tracker-log-card-stop-duration" });

			const completedMs = taskEntries
				.filter((entry) => entry.id !== activeEntry.id)
				.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
			stopDuration.setText(formatDuration(completedMs + (Date.now() - activeEntry.start)));
			this.activeCardTicks.push({ el: stopDuration, completedMs, start: activeEntry.start });

			stopBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				void this.actions.stopTracking();
			});
		} else {
			// Backlog Fase 5 — borrar la tarea completa (todo su historico, no
			// solo lo visible en el rango de fecha actual): con stopPropagation
			// para no disparar tambien el expandir/colapsar de la fila que lo
			// contiene. El chequeo de sesion activa usa this.getEntries() sin
			// acotar por dia/semana — la tarea puede tener su sesion activa hoy
			// aunque esta tarjeta en concreto muestre otro dia (vista semanal).
			const deleteBtn = meta.createEl("button", {
				cls: "task-time-tracker-log-card-delete task-time-tracker-icon-btn clickable-icon",
			});
			setIcon(deleteBtn, "trash-2");
			deleteBtn.setAttribute("aria-label", t("log.deleteTaskAriaLabel"));
			deleteBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				const hasActive = this.getEntries().some((entry) => entry.taskId === taskId && entry.end === null);
				if (hasActive) {
					new Notice(t("log.deleteBlockedActive"));
					return;
				}
				this.taskDeleteConfirmId = taskId;
				void this.render();
			});
		}

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
		meta.createSpan({
			text: `${fullTaskEntries.length} ${fullTaskEntries.length === 1 ? t("log.session.singular") : t("log.session.plural")}`,
			cls: "task-time-tracker-log-session-count",
		});
		// Mismo total agregado que la cabecera de la tarjeta (misma clase
		// CSS, mismo icono de cronometro), formato compacto — ver
		// formatDurationCompact().
		const totalGroup = meta.createSpan({ cls: "task-time-tracker-totals-duration-group" });
		setIcon(totalGroup.createSpan({ cls: "task-time-tracker-totals-duration-icon" }), "timer");
		totalGroup.createSpan({ text: formatDurationCompact(totalMs), cls: "task-time-tracker-totals-duration" });
		meta.createSpan({ text: taskId, cls: "task-time-tracker-log-taskid" });

		confirm.createEl("p", {
			text: t("log.deleteTaskConfirm"),
			cls: "task-time-tracker-log-edit-error",
		});

		const actions = confirm.createDiv({ cls: "task-time-tracker-log-edit-actions" });
		actions.createEl("button", { text: t("log.deleteTaskYes"), cls: "mod-warning" }).addEventListener("click", () => {
			void this.actions.deleteTask(taskId).then((result) => {
				if (!result.ok) {
					new Notice(t("log.deleteBlockedActive"));
				}
				this.taskDeleteConfirmId = null;
				void this.render();
			});
		});
		actions.createEl("button", { text: t("log.cancel") }).addEventListener("click", () => {
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

	// Fecha + hora inicio + hora fin (con indicador "+N" si abarca mas de
	// un dia natural) + duracion. Comun a la fila normal de una sesion y
	// al aviso de confirmacion de borrado (para que los datos de la
	// sesion sigan visibles mientras se confirma) — unico sitio que
	// calcula el badge, ver getDaySpan().
	private renderSessionInfo(container: Element, entry: TimeEntry): void {
		const info = container.createDiv({ cls: "task-time-tracker-log-session-info" });

		// Columna izquierda (fecha + rango horario): agrupada aparte de la
		// duracion para que esta ultima quede siempre alineada a la
		// derecha, con un min-width fijo en la fecha (ver styles.css) para
		// que actue como columna consistente entre filas.
		const left = info.createDiv({ cls: "task-time-tracker-log-session-left" });
		const startDate = new Date(entry.start);
		left.createSpan({ text: startDate.toLocaleDateString(), cls: "task-time-tracker-log-session-date" });

		const rangeSpan = left.createSpan({ cls: "task-time-tracker-log-session-range" });
		rangeSpan.createSpan({ text: startDate.toLocaleTimeString() });
		rangeSpan.createSpan({ text: " → " });
		if (entry.end !== null) {
			rangeSpan.createSpan({ text: new Date(entry.end).toLocaleTimeString() });
			const daySpan = getDaySpan(entry.start, entry.end);
			if (daySpan > 0) {
				rangeSpan.createSpan({ text: ` +${daySpan}`, cls: "task-time-tracker-log-nextday-badge" });
				// Fecha de fin de apoyo, solo junto al badge: en sesiones
				// largas (+N grande) evita que el usuario tenga que calcular
				// a mano la fecha final a partir de la de inicio. Tono
				// secundario (no el color del badge): el badge es la alerta,
				// esto es el detalle. Mismo formato que el resto de la fila
				// (toLocaleDateString(), sin formato propio). No se renderiza
				// en mobile (Platform.isMobile): el ancho de pantalla ahi es
				// mas critico y la fecha completa ya es visible al abrir el
				// formulario de edicion de esa sesion.
				if (!Platform.isMobile) {
					rangeSpan.createSpan({
						text: ` (${new Date(entry.end).toLocaleDateString()})`,
						cls: "task-time-tracker-log-nextday-date",
					});
				}
			}
		} else {
			rangeSpan.createSpan({ text: t("log.ongoing"), cls: "task-time-tracker-log-ongoing" });
		}

		if (entry.end !== null) {
			info.createSpan({
				text: formatDuration(entry.end - entry.start),
				cls: "task-time-tracker-log-session-duration",
			});
			return;
		}

		// Sesion en curso: mismo punto pulsante + contador en vivo que ya
		// usan el badge junto al checkbox y el boton de stop de la tarjeta
		// activa (misma clase, mismo bus), en vez de un guion suelto — asi
		// un cambio futuro de diseno del indicador de "activo" se propaga
		// a los tres sitios a la vez.
		const live = info.createDiv({
			cls: "task-time-tracker-log-session-duration task-time-tracker-log-session-live",
		});
		live.createSpan({ cls: "task-time-tracker-inline-dot" });
		const counter = live.createSpan({ cls: "task-time-tracker-log-session-live-value" });
		counter.setText(formatDuration(Date.now() - entry.start));
		this.activeCardTicks.push({ el: counter, completedMs: 0, start: entry.start });
	}

	// Abre el formulario de edicion de una sesion (clic en la fila). El
	// borrado de la sesion ya no tiene un punto de entrada directo desde
	// la fila (icono suelto en hover): la unica via es el boton "Eliminar"
	// dentro de este mismo formulario, que pone confirmingDelete a true
	// sobre el draft ya abierto (ver renderEditForm()).
	private openEditDraft(entry: TimeEntry): void {
		this.editDraft = {
			entryId: entry.id,
			startDate: formatDateInput(entry.start),
			startDateEvaluated: false,
			startTime: formatHMS(entry.start),
			startTimeEvaluated: false,
			endDate: formatDateInput(entry.end as number),
			endDateEvaluated: false,
			endTime: formatHMS(entry.end as number),
			endTimeEvaluated: false,
			error: null,
			confirmingDelete: false,
		};
		void this.render();
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
		// no hay un icono de editar aparte. El borrado individual ya no
		// tiene un icono propio en la fila — vive solo dentro del
		// formulario de edicion que abre este mismo click.
		if (entry.end !== null) {
			row.addClass("task-time-tracker-log-session-row-editable");
			row.addEventListener("click", () => this.openEditDraft(entry));
		}
	}

	// Campo de texto con icono + etiqueta encima (fecha u hora), parte de
	// una de las dos parejas (inicio/fin) del formulario de edicion. Sin
	// selector nativo del sistema: type="text" siempre, igual que ya
	// pasaba con las horas.
	private createEditField(container: Element, icon: string, label: string): HTMLInputElement {
		const field = container.createDiv({ cls: "task-time-tracker-log-edit-field" });
		const labelRow = field.createDiv({ cls: "task-time-tracker-log-edit-field-label" });
		setIcon(labelRow.createSpan(), icon);
		labelRow.createSpan({ text: label });
		const input = field.createEl("input", { cls: "task-time-tracker-log-edit-input" });
		input.type = "text";
		return input;
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
				text: t("log.deleteSessionConfirm"),
				cls: "task-time-tracker-log-edit-error",
			});
			const actions = form.createDiv({ cls: "task-time-tracker-log-edit-actions" });
			actions.createEl("button", { text: t("log.deleteSessionYes"), cls: "mod-warning" }).addEventListener("click", () => {
				void this.actions.deleteEntry(entry.id).then(() => {
					this.editDraft = null;
					void this.render();
				});
			});
			actions.createEl("button", { text: t("log.cancel") }).addEventListener("click", () => {
				draft.confirmingDelete = false;
				void this.render();
			});
			return;
		}

		// Bloque 3 UX — parejas etiquetadas con icono (fecha inicio/hora
		// inicio, fecha fin/hora fin), todas como campos de texto libres,
		// sin selector nativo del sistema ni siquiera para las fechas. El
		// grid se apila verticalmente en pantallas estrechas y pasa a una
		// sola fila si hay ancho suficiente (ver .task-time-tracker-log-edit-grid).
		const grid = form.createDiv({ cls: "task-time-tracker-log-edit-grid" });

		const startGroup = grid.createDiv({ cls: "task-time-tracker-log-edit-group" });
		const startDateInput = this.createEditField(startGroup, "calendar", t("log.editStartDateLabel"));
		const startInput = this.createEditField(startGroup, "clock", t("log.editStartTimeLabel"));
		startInput.placeholder = "HH:MM:SS";

		const endGroup = grid.createDiv({ cls: "task-time-tracker-log-edit-group" });
		const endDateInput = this.createEditField(endGroup, "calendar", t("log.editEndDateLabel"));
		const endInput = this.createEditField(endGroup, "clock", t("log.editEndTimeLabel"));
		endInput.placeholder = "HH:MM:SS";

		startDateInput.value = draft.startDate;
		startInput.value = draft.startTime;
		endDateInput.value = draft.endDate;
		endInput.value = draft.endTime;

		// El estado "invalido" se guarda en el draft ({campo}Evaluated),
		// no solo como clase CSS: un refresh externo reconstruye este
		// formulario entero (ver comentario en EditDraft), y sin esto la
		// marca visual se perderia aunque el campo siguiera siendo
		// invalido.
		startDateInput.toggleClass("is-invalid", draft.startDateEvaluated && parseDateInput(draft.startDate) === null);
		startInput.toggleClass("is-invalid", draft.startTimeEvaluated && parseTimeInput(draft.startTime) === null);
		endDateInput.toggleClass("is-invalid", draft.endDateEvaluated && parseDateInput(draft.endDate) === null);
		endInput.toggleClass("is-invalid", draft.endTimeEvaluated && parseTimeInput(draft.endTime) === null);

		// Bloque resaltado de solo lectura: duracion calculada en vivo a
		// partir de los cuatro campos. Icono + label a la izquierda, valor
		// a la derecha con mayor peso tipografico — a proposito sin la
		// affordance de input de los 4 campos de arriba (ver
		// .task-time-tracker-log-edit-input en styles.css): la ausencia de
		// borde/fondo tipo-input es lo que comunica "esto no se edita
		// directamente".
		const durationBlock = form.createDiv({ cls: "task-time-tracker-log-edit-duration" });
		const durationLabelGroup = durationBlock.createDiv({ cls: "task-time-tracker-log-edit-duration-label-group" });
		setIcon(durationLabelGroup.createSpan(), "timer");
		durationLabelGroup.createSpan({
			text: t("log.editDurationLabel"),
			cls: "task-time-tracker-log-edit-duration-label",
		});
		const durationPreview = durationBlock.createSpan({ cls: "task-time-tracker-log-edit-duration-value" });

		// Bloque de aviso unico y fijo, justo debajo del bloque de
		// duracion: siempre en la misma posicion, con altura reservada
		// aunque no haya nada que mostrar, para que el formulario no
		// salte de alto. Nunca muestra dos mensajes a la vez — ver
		// updateMessage() para la prioridad entre ellos.
		const messageEl = form.createEl("p", { cls: "task-time-tracker-log-edit-message" });

		const actions = form.createDiv({ cls: "task-time-tracker-log-edit-actions" });
		actions.createEl("button", { text: t("log.save"), cls: "mod-cta" }).addEventListener("click", () => {
			void this.saveEditDraft(entry);
		});
		actions.createEl("button", { text: t("log.cancel") }).addEventListener("click", () => {
			this.editDraft = null;
			void this.render();
		});

		// "Eliminar sesion": icono de papelera en vez de boton de texto,
		// mismo estilo que el de borrar la tarea completa
		// (task-time-tracker-log-card-delete), en la misma fila que
		// Guardar/Cancelar, empujado al extremo derecho.
		const deleteBtn = actions.createEl("button", { cls: "task-time-tracker-log-edit-delete clickable-icon" });
		setIcon(deleteBtn, "trash-2");
		deleteBtn.setAttribute("aria-label", t("log.delete"));
		deleteBtn.addEventListener("click", () => {
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
		// si algun campo ya fue evaluado (blur o longitud completa, ver
		// bindDraftField; nunca mientras se sigue escribiendo) 3) fin <=
		// inicio (una vez el formato es valido) 4) aviso de solapamiento
		// (solo con formato valido y fin > inicio) 5) nada.
		const updateMessage = () => {
			if (draft.error) {
				setMessage(draft.error, "error");
				return;
			}
			const startDateInvalid = draft.startDateEvaluated && parseDateInput(draft.startDate) === null;
			const endDateInvalid = draft.endDateEvaluated && parseDateInput(draft.endDate) === null;
			const startTimeInvalid = draft.startTimeEvaluated && parseTimeInput(draft.startTime) === null;
			const endTimeInvalid = draft.endTimeEvaluated && parseTimeInput(draft.endTime) === null;
			if (startDateInvalid || endDateInvalid || startTimeInvalid || endTimeInvalid) {
				setMessage(t("log.errorFormat"), "error");
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
				setMessage(t("log.errorRange"), "error");
				return;
			}

			const { start, end } = effectiveRange(draft, entry, resolved);
			const overlapping = this.getEntries().some(
				(other) => other.id !== entry.id && rangesOverlap(start, end, other.start, other.end ?? Date.now()),
			);
			setMessage(overlapping ? t("log.warnOverlap") : "", overlapping ? "warning" : "none");
		};

		// Vista previa en vivo de la duracion calculada, sin reconstruir
		// el formulario entero — eso perderia el foco del input a mitad
		// de tecleo. Sin duracion valida todavia (campos incompletos o
		// fuera de rango), se muestra "—" en vez de dejar el bloque vacio.
		const updatePreview = () => {
			const resolved = resolveDraftTimestamps(draft);
			if (!resolved.ok) {
				durationPreview.setText("—");
				return;
			}
			const { start, end } = effectiveRange(draft, entry, resolved);
			durationPreview.setText(end > start ? formatDuration(end - start) : "—");
		};

		// El formato NO se evalua en cada tecla (seria prematuro mientras
		// el usuario sigue escribiendo): solo al perder el foco (blur) o
		// al llegar a la longitud completa del campo (10 caracteres
		// "YYYY-MM-DD", 8 "HH:MM:SS") — ver EditDraft sobre por que el
		// resultado se guarda en el draft (setEvaluated) y no solo como
		// clase CSS. Mientras tanto, se limpia para no dejar una marca
		// vieja mientras se sigue corrigiendo. Sin selector nativo ni
		// flechas arriba/abajo: se edita solo a mano.
		const bindDraftField = (
			input: HTMLInputElement,
			isValid: (value: string) => boolean,
			fullLength: number,
			apply: (value: string) => void,
			setEvaluated: (value: boolean) => void,
		) => {
			const evaluateFormat = () => {
				setEvaluated(true);
				input.toggleClass("is-invalid", !isValid(input.value));
				updateMessage();
			};
			input.addEventListener("input", () => {
				apply(input.value);
				updatePreview();
				if (input.value.length >= fullLength) evaluateFormat();
				else {
					setEvaluated(false);
					input.removeClass("is-invalid");
					updateMessage();
				}
			});
			input.addEventListener("blur", evaluateFormat);
		};

		bindDraftField(
			startDateInput,
			(value) => parseDateInput(value) !== null,
			10,
			(value) => (draft.startDate = value),
			(value) => (draft.startDateEvaluated = value),
		);
		bindDraftField(
			startInput,
			(value) => parseTimeInput(value) !== null,
			8,
			(value) => (draft.startTime = value),
			(value) => (draft.startTimeEvaluated = value),
		);
		bindDraftField(
			endDateInput,
			(value) => parseDateInput(value) !== null,
			10,
			(value) => (draft.endDate = value),
			(value) => (draft.endDateEvaluated = value),
		);
		bindDraftField(
			endInput,
			(value) => parseTimeInput(value) !== null,
			8,
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
			draft.error = t("log.errorRange");
			void this.render();
			return;
		}

		const result = await this.actions.updateEntryTimes(entry.id, resolved.start, resolved.end);
		if (!result.ok) {
			draft.error = result.error === "invalid-range" ? t("log.errorRange") : t("log.errorGone");
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
			new Notice(t("notice.noteNotFound"));
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

	// Bloque 2 — barra de navegacion de fecha: dos grupos atomicos (nunca
	// se rompen por dentro) dentro de un unico flex-wrap, sin media
	// queries: Grupo A (Dia/Semana/Hoy) y Grupo B (flechas + fecha). Con
	// espacio de sobra ambos caben en una linea (A a la izquierda, B
	// ocupando y centrando el resto — ver .task-time-tracker-log-datenav
	// en styles.css); en mobile, con el panel mas estrecho que la
	// pantalla, cada grupo baja a su propia linea, ambos centrados.
	private renderDateNav(container: Element): void {
		const nav = container.createDiv({ cls: "task-time-tracker-log-datenav" });

		const groupA = nav.createDiv({ cls: "task-time-tracker-log-datenav-group-a" });

		const modeToggle = groupA.createDiv({ cls: "task-time-tracker-log-datenav-mode" });
		const dayBtn = modeToggle.createEl("button", {
			text: t("log.viewDay"),
			cls: "task-time-tracker-log-datenav-mode-btn",
		});
		const weekBtn = modeToggle.createEl("button", {
			text: t("log.viewWeek"),
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

		const todayBtn = groupA.createEl("button", { text: t("log.today") });
		todayBtn.addEventListener("click", () => {
			this.anchorDate = startOfDay(Date.now());
			void this.render();
		});

		const range = nav.createDiv({ cls: "task-time-tracker-log-datenav-range" });
		const prevBtn = range.createEl("button", { cls: "clickable-icon" });
		setIcon(prevBtn, "chevron-left");
		prevBtn.setAttribute("aria-label", this.viewMode === "day" ? t("log.navPrevDay") : t("log.navPrevWeek"));
		prevBtn.addEventListener("click", () => {
			this.anchorDate = addDays(this.anchorDate, this.viewMode === "day" ? -1 : -7);
			void this.render();
		});

		range.createSpan({ text: this.formatRangeLabel(), cls: "task-time-tracker-log-datenav-label" });

		const nextBtn = range.createEl("button", { cls: "clickable-icon" });
		setIcon(nextBtn, "chevron-right");
		nextBtn.setAttribute("aria-label", this.viewMode === "day" ? t("log.navNextDay") : t("log.navNextWeek"));
		nextBtn.addEventListener("click", () => {
			this.anchorDate = addDays(this.anchorDate, this.viewMode === "day" ? 1 : 7);
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
		withHeading: boolean,
		token: number,
	): Promise<void> {
		const dayEntries = allEntries
			.filter((entry) => isSameLocalDay(entry.start, dayStart))
			.sort((a, b) => b.start - a.start);

		if (withHeading) {
			container.createEl("h6", { text: this.formatDayHeading(dayStart), cls: "task-time-tracker-log-day-heading" });
		}

		if (dayEntries.length === 0) {
			container.createEl("p", { text: t("log.emptyDay"), cls: "task-time-tracker-log-empty-day" });
			return;
		}

		const resolutions = await this.resolveTaskIds(dayEntries);
		// Una llamada a render() mas reciente ya tomo el control del
		// contenedor mientras se resolvian los tt-id de esta seccion —
		// ver comentario de renderToken. Abortar aqui evita duplicar
		// tarjetas encima del resultado (ya correcto) de esa llamada mas
		// reciente.
		if (token !== this.renderToken) return;
		this.renderTaskList(container, dayEntries, resolutions, dayStart);
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const container = this.containerEl.children[1];
		if (!container) return;

		const allEntries = this.getEntries();
		// Se recalcula desde cero en cada render(): si la tarjeta activa no
		// se vuelve a renderizar (p. ej. se navega a otra fecha), el tick
		// deja de tener efecto en vez de apuntar a un nodo ya desmontado.
		this.activeCardTicks = [];

		container.empty();
		container.createEl("h4", { text: t("log.title") });

		if (allEntries.length === 0) {
			container.createEl("p", { text: t("log.emptyAll") });
			return;
		}

		this.renderDateNav(container);

		if (this.viewMode === "day") {
			await this.renderDaySection(container, startOfDay(this.anchorDate), allEntries, false, token);
		} else {
			const weekStart = startOfWeek(this.anchorDate);
			for (let i = 0; i < 7; i++) {
				if (token !== this.renderToken) return;
				await this.renderDaySection(container, addDays(weekStart, i), allEntries, true, token);
			}
		}
	}
}
