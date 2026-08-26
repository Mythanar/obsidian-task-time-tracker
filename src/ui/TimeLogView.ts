// ui/TimeLogView.ts
// Fase 1 — MVP de tracking local (panel de historial basico).
// Fase 2 — cada entrada se resuelve por su tt-id::; si la linea ya no
// existe en ninguna nota, se muestra como "Tarea no encontrada" sin
// descartar el historico.
// Rediseno "Editar tarea desde el Historial" (agosto 2026) — la tarjeta
// pasa a ser de solo lectura con tres zonas clicables independientes
// (icono de nota, menu kebab, linea de sesiones que expande/colapsa un
// detalle de solo lectura); toda la gestion (reasignar Proyecto/Cliente,
// editar sesiones, borrar sesion) vive en EditTaskModal.ts. El borrado de
// tarea completa se dispara solo desde el kebab.

import { ItemView, Menu, MarkdownView, Notice, Platform, TFile, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import { formatDuration, formatDurationCompact } from "../core/TrackingEngine";
import { parseCheckboxLine, ResolvedTask, TaskIdentifier } from "../core/TaskIdentifier";
import { t } from "../i18n";
import { DeleteTaskResult, EntryUpdateResult, Project, TimeEntry } from "../types";
import { openDatePickerPopover } from "./DatePickerPopover";
import { EditTaskModal } from "./EditTaskModal";
import { InlineTrackingBus } from "./InlineTrackingBus";
import { openProjectPickerPopover } from "./ProjectPickerList";
import { renderSessionInfo } from "./sessionEdit";

export const TIME_LOG_VIEW_TYPE = "task-time-tracker-log-view";

export interface TimeLogViewActions {
	updateEntryTimes(entryId: string, start: number, end: number): Promise<EntryUpdateResult>;
	deleteEntry(entryId: string): Promise<void>;
	deleteTask(taskId: string): Promise<DeleteTaskResult>;
	stopTracking(): Promise<void>;
	// Historico completo de una tarea (todas sus sesiones, sin acotar por
	// dia/semana visible) — alimenta el modal de Editar, que gestiona
	// todo el historico y no solo lo que la tarjeta muestra ahora mismo.
	getEntriesForTask(taskId: string): TimeEntry[];
	getProjects(): Project[];
	getProjectForTask(taskId: string): Project | null;
	assignProject(taskId: string, projectId: string | null): Promise<void>;
	// Mismo bus que ya usa el badge junto al checkbox (ver
	// InlineTaskControlExtension.ts): notifica cada segundo mientras haya
	// una sesion activa, para que la tarjeta de esa tarea (si esta en el
	// rango de fecha visible) actualice su contador en vivo sin necesidad
	// de un render() completo del panel.
	bus: InlineTrackingBus;
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

// Formato corto de fecha para el estado vacio de Resultados ("17 y 23
// ago"): dia + mes abreviado, resuelto via Intl para seguir el idioma de
// Obsidian.
function formatShortDate(ms: number): string {
	return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// Vista de resultados por rango — numero maximo de dias de calendario que
// se resuelven/renderizan por pagina (ver renderResultsSection()): un
// rango mayor no tiene limite de seleccion, pero la lista se corta aqui y
// un boton "Cargar mas" añade la siguiente pagina, para no intentar
// resolver de golpe cientos/miles de dias (la inmensa mayoria vacios) de
// un rango muy amplio (p. ej. un año).
const RESULTS_PAGE_DAYS = 180;

type LogViewMode = "day" | "week" | "results";

export class TimeLogView extends ItemView {
	// Claves de expandedTaskIds son "<dia>|<taskId>" (no solo taskId): en
	// vista semanal la misma tarea puede tener sesiones en varios dias, cada
	// uno con su propia tarjeta, y deben poder expandirse de forma
	// independiente.
	private expandedTaskIds = new Set<string>();
	// QA — expandKey de la tarjeta que se acaba de expandir en este mismo
	// gesto (no de una ya expandida de antes): dispara el scroll automatico
	// hasta el final del detalle (sesion mas reciente) una sola vez, no en
	// cada render() posterior mientras la tarjeta siga expandida.
	private pendingScrollKey: string | null = null;
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
	// Filtro por proyecto del header (ver renderProjectFilter()): en
	// memoria del componente, nunca persistido en data.json — cada
	// apertura del panel arranca sin filtro, igual que arranca siempre en
	// "hoy"/vista diaria (ver comentario de viewMode arriba).
	private projectFilterId: string | null = null;
	// Filtro "No project" (ver renderProjectFilter()): estado aparte de
	// projectFilterId porque null en projectFilterId ya significa "sin
	// filtro" — este filtro necesita un tercer estado (proyecto concreto /
	// sin filtro / sin proyecto) que projectFilterId solo no puede
	// representar. Mutuamente excluyente con projectFilterId: nunca los
	// dos activos a la vez.
	private projectFilterNoProject = false;
	// Vista de resultados por rango (ver renderResultsSection()): solo
	// tienen sentido cuando viewMode === "results" — un rango de dos dias
	// distintos aplicado en el date-picker (ver renderDateNav()) los
	// establece; "Volver"/"Limpiar" no los borra, solo cambia viewMode a
	// "day" (se sobrescriben en el proximo rango aplicado, no hace falta
	// limpiarlos antes).
	private resultsRangeStart: number | null = null;
	private resultsRangeEnd: number | null = null;
	// Cuantas paginas de RESULTS_PAGE_DAYS dias ya se han "cargado" (boton
	// "Cargar mas") para el rango actual — se reinicia a 1 cada vez que se
	// aplica un rango nuevo desde el date-picker.
	private resultsLoadedPages = 1;
	// Elementos con contador en vivo de la tarea activa (si esta en el
	// rango de fecha visible tras el ultimo render()): se recalculan cada
	// segundo via el bus, sin reconstruir el panel entero. Puede haber mas
	// de uno a la vez — el boton de stop de la cabecera y, si la tarjeta
	// esta expandida, la fila de su sesion en curso dentro del detalle.
	// Vacio si la tarea con tracking activo no aparece en ningun elemento
	// actualmente renderizado.
	// kind "duration": formatDuration (HH:MM:SS), se redibuja cada tick.
	// kind "total": formatDurationCompact (Xh Ym) del sumatorio de la
	// tarjeta — mismo tick de cada segundo, pero solo toca el DOM cuando
	// el minuto mostrado cambia (lastMinute), ya que el formato compacto
	// no tiene segundos y redibujar cada segundo seria trabajo de sobra.
	private activeCardTicks: Array<
		| { kind: "duration"; el: HTMLElement; completedMs: number; start: number }
		| { kind: "total"; el: HTMLElement; completedMs: number; start: number; lastMinute: number }
	> = [];
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
		for (const entry of this.activeCardTicks) {
			const elapsedMs = entry.completedMs + (Date.now() - entry.start);
			if (entry.kind === "duration") {
				entry.el.setText(formatDuration(elapsedMs));
				continue;
			}
			// Por debajo del minuto, formatDurationCompact ya devuelve "Ns"
			// (mismo criterio que el resto del panel para sesiones cortas):
			// se redibuja cada tick, igual que el contador "duration" de al
			// lado, para no dar sensacion de que el sumatorio esta clavado
			// durante el primer minuto de una sesion activa. A partir del
			// minuto (formato "Xh Ym"/"Ym"), vuelve a redibujarse solo si
			// el minuto mostrado cambia.
			const minute = Math.floor(elapsedMs / 60000);
			if (minute > 0 && minute === entry.lastMinute) continue;
			entry.lastMinute = minute;
			entry.el.setText(formatDurationCompact(elapsedMs));
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
	// viene ordenado por fecha de inicio ascendente desde renderDaySection()),
	// asi que cada tarea queda ordenada por la fecha de su sesion mas
	// antigua de ese dia.
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

	// Tarjeta de solo lectura con tres zonas clicables independientes (ver
	// rediseno "Editar tarea desde el Historial"): icono abrir nota, menu
	// kebab (Editar/Eliminar), y la linea de sesiones que expande/colapsa
	// un detalle tambien de solo lectura. Nada mas de la tarjeta reacciona
	// al clic — ni la cabecera completa ni el area en blanco.
	// El total (totalMs) es el de taskEntries tal cual llega: acotado al
	// rango de fecha visible (dia o semana), a proposito distinto del total
	// historico completo que muestra el badge junto al checkbox (Fase 5) y
	// del historico completo que gestiona el modal de Editar.
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
		const project = this.actions.getProjectForTask(taskId);

		const card = list.createDiv({ cls: "task-time-tracker-log-row" });
		card.toggleClass("is-tracking-active", activeEntry !== null);

		const header = card.createDiv({ cls: "task-time-tracker-log-card-header" });
		// Cambio de comportamiento (3a pasada de QA visual del rediseno
		// visual del Historial, revert parcial deliberado de la decision de
		// Fase 5 "ningun control depende solo del hover"): toda la cabecera
		// (icono/titulo/meta + fila de proyecto) expande o colapsa al clic;
		// el hover en escritorio la resalta como añadido puramente visual
		// sobre ese mismo gesto. El icono de nota y el kebab siguen siendo
		// sus propias zonas independientes (evt.stopPropagation ya existente
		// en ambos). `detail` (el desplegable) vive fuera de `header`, en
		// `card` — clicar dentro de una sesion ya expandida no vuelve a
		// colapsar la tarjeta.
		header.addEventListener("click", () => {
			if (expanded) {
				this.expandedTaskIds.delete(expandKey);
			} else {
				this.expandedTaskIds.add(expandKey);
				this.pendingScrollKey = expandKey;
			}
			void this.render();
		});

		// Reestructuracion (6a pasada de QA visual — diff explicito contra el
		// HTML exportado de Claude Design): la fila exterior tiene 3 hijos
		// directos, no 5. icono+titulo+proyecto/cliente viven juntos dentro
		// de `infoBlock` (flex:1 1 auto, columna) — SOLO ASI la columna
		// derecha y el kebab, hermanos de `infoBlock` (no de `titleLine`),
		// se pueden alinear contra el bloque completo (titulo + meta), no
		// solo contra la primera fila. Sin chevron (5a pasada): la fila
		// entera ya expande/colapsa al clic (ver header.addEventListener
		// arriba).
		const outerRow = header.createDiv({ cls: "task-time-tracker-log-card-title-row" });
		const infoBlock = outerRow.createDiv({ cls: "task-time-tracker-log-card-info" });

		// Fila de titulo: icono + nombre, anidada dentro de infoBlock (antes
		// vivian sueltos como hijos directos de la fila exterior).
		const titleLine = infoBlock.createDiv({ cls: "task-time-tracker-log-card-title-line" });
		if (!isMissing) {
			// Zona 1 — unico punto de navegacion hacia la nota; hit-area e
			// hijos propios, no interfiere con el titulo ni con el kebab.
			const noteBtn = titleLine.createEl("button", {
				cls: "task-time-tracker-log-card-note task-time-tracker-icon-btn clickable-icon",
			});
			setIcon(noteBtn, "file-search");
			noteBtn.setAttribute("aria-label", t("log.openNoteAriaLabel"));
			setTooltip(noteBtn, t("log.openNoteAriaLabel"));
			noteBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				void this.openTaskNote(taskId, taskEntries);
			});
		} else {
			// Tarea "no encontrada": misma clase que el icono de nota normal
			// (mismo tamaño e hit-area) — solo cambia el icono y la accion al
			// clic, que ya no puede abrir una nota que no existe.
			const missingBtn = titleLine.createEl("button", {
				cls: "task-time-tracker-log-card-note task-time-tracker-icon-btn clickable-icon",
			});
			setIcon(missingBtn, "file-x");
			missingBtn.setAttribute("aria-label", t("log.noteNotFoundAriaLabel"));
			missingBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				new Notice(t("notice.noteNotFound"));
			});
		}

		// Titulo: sin hover ni accion de clic propia (la navegacion vive
		// solo en el icono de arriba) — solo tooltip con el texto completo
		// en desktop si esta truncado.
		const title = titleLine.createDiv({ text: label, cls: "task-time-tracker-log-task" });
		if (isMissing) {
			title.addClass("task-time-tracker-log-task-missing");
		}

		if (isMissing) {
			const mostRecent = taskEntries.reduce((latest, entry) => (entry.start > latest.start ? entry : latest));
			infoBlock.createDiv({ text: mostRecent.taskText, cls: "task-time-tracker-log-task-snapshot" });
		}

		// Fila 2 — Proyecto/Cliente: solo si hay proyecto asignado (vinculo
		// vivo por tt-id, ver ProjectManager#getProjectForTask). Dentro de
		// infoBlock (ya no hermana suelta de la fila de titulo), indentada
		// con padding-left bajo el TEXTO del titulo, no bajo el icono (ver
		// renderProjectRow()). Sin hover ni accion de clic propia; reasignar
		// sigue viviendo dentro del modal de Editar.
		if (project) {
			this.renderProjectRow(infoBlock, project);
		}

		// Columna derecha (3a pasada de QA visual; "N sessions" bajado
		// debajo del total en la 4a; ahora hermana de infoBlock, no de
		// titleLine, en la 6a — ver Time Tracker Tab.dc.html actualizado en
		// docs/Prototype, lineas 124-127): duracion agregada arriba, nº de
		// sesiones debajo, apiladas en su propia columna — kebab a
		// continuacion, siempre en esa misma fila exterior. tt-id se retira
		// de esta vista (decision QA): no aporta al usuario final y no tenia
		// hueco en el diseno de columna derecha; sigue existiendo como
		// concepto interno (ProjectManager, ver TaskIdentifier), solo deja
		// de pintarse aqui.
		const rightCol = outerRow.createDiv({ cls: "task-time-tracker-log-card-right-col" });
		// Total agregado (varias sesiones sumadas): formato compacto, no
		// HH:MM:SS — ver formatDurationCompact(). Icono de cronometro solo
		// si hay tracking activo (ver mismo criterio en renderViewTotal() y
		// renderDayHeading()).
		const totalGroup = rightCol.createSpan({ cls: "task-time-tracker-totals-duration-group" });
		if (activeEntry) {
			setIcon(totalGroup.createSpan({ cls: "task-time-tracker-totals-duration-icon" }), "timer");
		}
		const totalDuration = totalGroup.createSpan({
			text: formatDurationCompact(totalMs),
			cls: "task-time-tracker-totals-duration",
		});
		rightCol.createSpan({
			text: `${taskEntries.length} ${taskEntries.length === 1 ? t("log.session.singular") : t("log.session.plural")}`,
			cls: "task-time-tracker-log-session-count",
		});

		// Zona 2 — menu kebab: siempre visible (decision QA — se mantiene
		// como zona independiente del boton de stop de abajo, en vez de
		// fundirse en una unica posicion contextual), no depende de expandir
		// la tarjeta ni de hover de fila. Hermano de infoBlock/rightCol en la
		// fila exterior.
		const menuBtn = outerRow.createEl("button", {
			cls: "task-time-tracker-log-card-menu task-time-tracker-icon-btn clickable-icon",
		});
		setIcon(menuBtn, "more-vertical");
		menuBtn.setAttribute("aria-label", t("log.taskMenuAriaLabel"));
		setTooltip(menuBtn, t("log.taskMenuAriaLabel"));
		menuBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.openTaskMenu(menuBtn, taskId, label);
		});

		if (activeEntry) {
			// Boton de stop con contador en vivo, mismo patron de pill que el
			// badge junto al checkbox (icono relleno + numero en
			// monoespaciada). completedMs es la suma de las sesiones YA
			// cerradas de esta tarjeta; el tick de cada segundo (via el bus)
			// le suma el tiempo transcurrido desde activeEntry.start. Vive en
			// la misma fila exterior que el kebab (decision QA — elemento
			// adicional, no lo sustituye), tras el, como ultimo elemento.
			const stopBtn = outerRow.createEl("button", { cls: "task-time-tracker-log-card-stop" });
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
			this.activeCardTicks.push({ kind: "duration", el: stopDuration, completedMs, start: activeEntry.start });
			// Sumatorio de la cabecera ("N sessions · Xh Ym"): mismo completedMs/
			// start que el contador de arriba, pero en formato compacto y sin
			// redibujar cada segundo (ver tickActiveCard) — bug reportado por el
			// usuario: antes solo se actualizaba con un refresh externo del panel.
			this.activeCardTicks.push({
				kind: "total",
				el: totalDuration,
				completedMs,
				start: activeEntry.start,
				lastMinute: Math.floor(totalMs / 60000),
			});

			stopBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				void this.actions.stopTracking();
			});
		}

		// Medir DESPUES de que titleLine y el resto de hermanos de la fila
		// exterior (proyecto/cliente, columna derecha, kebab, stop si lo
		// hay) esten todos insertados — ver comentario detallado sobre este
		// mismo bug en renderProjectRow() mas abajo, donde se detecto: medir
		// un span antes de que sus hermanos existan da un clientWidth mas
		// generoso de lo que sera una vez ocupen su espacio, y el helper
		// decide (con datos aun no definitivos) que no hace falta tooltip.
		this.applyTruncationTooltip(title, label);

		if (expanded) {
			const detail = card.createDiv({ cls: "task-time-tracker-log-card-detail" });
			// Orden cronologico ascendente (mas antigua arriba, mas reciente
			// abajo) — taskEntries ya viene en ese orden (ver groupByTaskId).
			for (const entry of taskEntries) {
				const row = detail.createDiv({ cls: "task-time-tracker-log-session-row" });
				renderSessionInfo(row, entry, (el, completedMs, start) =>
					this.activeCardTicks.push({ kind: "duration", el, completedMs, start }),
				);
			}
			// QA — al expandir (no al re-renderizar una tarjeta ya expandida
			// por otro motivo), deja visible la sesion mas reciente sin scroll
			// manual. setTimeout(0): espera a que el navegador termine el
			// layout de este render antes de medir/hacer scroll.
			if (this.pendingScrollKey === expandKey) {
				this.pendingScrollKey = null;
				window.setTimeout(() => detail.scrollIntoView({ block: "end" }), 0);
			}
		}
	}

	// Icono maletin (proyecto) + icono persona (cliente, si tiene).
	// Indentado con padding-left bajo el TEXTO del titulo (6a pasada de QA
	// visual — antes un div-spacer .task-time-tracker-log-card-icon-col
	// vacio, misma idea pero indentando bajo el ICONO, no bajo el texto;
	// ver styles.css) — pero SOLO en la tarjeta normal, cuyo titulo tiene
	// icono de nota delante. indented=false desactiva ese padding para la
	// confirmacion de borrado (ver abajo), cuyo titulo no lleva icono
	// delante: con el padding puesto ahi, la fila quedaba indentada sin
	// motivo respecto al titulo (bug de QA, ronda 2). Sin hover, sin accion
	// de clic — reasignar vive dentro del modal de Editar (Zona 2, kebab ->
	// Editar).
	// project null: solo ocurre cuando llama renderTaskDeleteConfirm() (ver
	// abajo) — a diferencia de la tarjeta normal, que omite la fila entera
	// si no hay proyecto asignado, la confirmacion de borrado lo muestra
	// explicito ("No project") por ser el paso previo a una accion
	// irreversible, donde preferimos explicito sobre implicito.
	private renderProjectRow(container: HTMLElement, project: Project | null, indented = true): void {
		const row = container.createDiv({ cls: "task-time-tracker-log-card-project-row" });
		row.toggleClass("is-indented", indented);

		if (!project) {
			const emptySpan = row.createSpan({ cls: "task-time-tracker-log-card-project-item" });
			setIcon(emptySpan.createSpan({ cls: "task-time-tracker-log-card-project-icon" }), "briefcase");
			emptySpan.createSpan({ text: t("log.editModalNoProject") });
			return;
		}

		const projectSpan = row.createSpan({ cls: "task-time-tracker-log-card-project-item" });
		setIcon(projectSpan.createSpan({ cls: "task-time-tracker-log-card-project-icon" }), "briefcase");
		const projectText = projectSpan.createSpan({ text: project.name, cls: "task-time-tracker-log-card-project-name" });

		const client = project.client;
		let clientTooltip: { el: HTMLElement; text: string } | null = null;
		if (client) {
			const clientSpan = row.createSpan({ cls: "task-time-tracker-log-card-project-item" });
			setIcon(clientSpan.createSpan({ cls: "task-time-tracker-log-card-project-icon" }), "user");
			clientTooltip = { el: clientSpan.createSpan({ text: client, cls: "task-time-tracker-log-card-project-name" }), text: client };
		}

		// Bug de QA — Cliente si mostraba tooltip, Proyecto no, con el
		// mismo helper: Proyecto se media (aqui abajo) antes de que el
		// span de Cliente (su hermano en la misma fila flex, ver
		// .task-time-tracker-log-card-project-row) llegara a existir. En
		// ese instante el layout de la fila solo tiene un item compitiendo
		// por el espacio, asi que projectText.clientWidth sale mas ancho
		// de lo que sera una vez Cliente tambien este presente — el
		// helper decidia (con un ancho todavia no definitivo) que no
		// hacia falta tooltip. Cliente, al medirse siempre en ultimo
		// lugar (ya con Proyecto presente), nunca sufria esto. Fix: medir
		// los dos solo despues de insertar ambos spans, no el helper en
		// si (ver applyTruncationTooltip).
		this.applyTruncationTooltip(projectText, project.name);
		if (clientTooltip) this.applyTruncationTooltip(clientTooltip.el, clientTooltip.text);
	}

	// Tooltip nativo con el texto completo solo si el contenido esta
	// realmente truncado por CSS y solo en desktop — en mobile no hay
	// hover, asi que no hay donde mostrarlo (ver rediseno "Editar tarea
	// desde el Historial"). Se llama de forma sincrona justo tras insertar
	// `el` en un DOM ya adjunto (la tarjeta vive dentro del panel visible
	// desde antes de este punto), asi que el layout ya esta resuelto al
	// leer estas propiedades — no hace falta esperar (leer clientWidth/
	// scrollWidth fuerza un reflow sincrono si hiciera falta). El requisito
	// real es que `el` mismo tenga una caja con overflow:hidden (mas
	// text-overflow:ellipsis para una linea, o -webkit-line-clamp para
	// varias — ver .task-time-tracker-log-card-project-name y el titulo de
	// la tarjeta respectivamente en styles.css): un <span> sin esas reglas
	// propias (display:inline puro) siempre da clientWidth/clientHeight 0,
	// asi que la comparacion nunca detecta truncamiento — bug de QA
	// corregido aplicando esas reglas al span de texto mismo, no a un
	// contenedor distinto. scrollHeight > clientHeight (ademas del ancho,
	// ya comprobado antes) detecta el caso del titulo de 2 lineas — el
	// recorte de -webkit-line-clamp trunca por alto, no por ancho, asi que
	// scrollWidth > clientWidth solo no basta ahi.
	private applyTruncationTooltip(el: HTMLElement, fullText: string): void {
		if (Platform.isMobile) return;
		if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) setTooltip(el, fullText);
	}

	// Zona 2 — menu kebab: Editar (abre EditTaskModal con el historico
	// completo de la tarea) y Eliminar (misma guarda de sesion activa y
	// misma confirmacion de borrado de tarea completa de siempre, Fase 5).
	private openTaskMenu(anchor: HTMLElement, taskId: string, label: string): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t("log.menuEdit"))
				.setIcon("pencil")
				.onClick(() => this.openEditTaskModal(taskId, label)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t("log.menuDelete"))
				.setIcon("trash")
				.setWarning(true)
				.onClick(() => this.requestDeleteTask(taskId)),
		);
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	// El chequeo de sesion activa usa this.getEntries() sin acotar por
	// dia/semana — la tarea puede tener su sesion activa hoy aunque esta
	// tarjeta en concreto muestre otro dia (vista semanal).
	private requestDeleteTask(taskId: string): void {
		const hasActive = this.getEntries().some((entry) => entry.taskId === taskId && entry.end === null);
		if (hasActive) {
			new Notice(t("log.deleteBlockedActive"));
			return;
		}
		this.taskDeleteConfirmId = taskId;
		void this.render();
	}

	// Abre el modal de Editar con el historico completo de la tarea (no
	// solo las entries acotadas al dia/semana visible de esta tarjeta) —
	// ver TimeLogViewActions#getEntriesForTask.
	private openEditTaskModal(taskId: string, label: string): void {
		new EditTaskModal(
			this.app,
			taskId,
			label,
			this.actions.getEntriesForTask(taskId),
			this.getEntries,
			this.actions.getProjects(),
			this.actions.getProjectForTask(taskId),
			{
				assignProject: (id, projectId) => this.actions.assignProject(id, projectId),
				updateEntryTimes: (entryId, start, end) => this.actions.updateEntryTimes(entryId, start, end),
				deleteEntry: (entryId) => this.actions.deleteEntry(entryId),
			},
			() => void this.render(),
		).open();
	}

	// Backlog Fase 5 — confirmacion de borrado de tarea completa. Mismo
	// patron de datos visibles + Si/Cancelar que usa el formulario de
	// edicion de sesion dentro del modal de Editar (EditTaskModal.ts),
	// reutilizando las mismas clases CSS. A diferencia de la tarjeta
	// normal (cuyo total puede venir acotado a un dia/semana), aqui se
	// recalculan sesiones y total SIEMPRE sobre el historico completo de
	// la tarea (this.getEntries() sin filtrar por fecha): lo que se
	// muestra debe coincidir exactamente con lo que se va a borrar.
	// Orden de arriba a abajo: titulo, resumen, aviso, botones (todo junto,
	// sin scroll, para decidir y confirmar) y, tras una linea divisoria, el
	// detalle completo de todas las sesiones (renderSessionInfo, solo
	// lectura, ver sessionEdit.ts).
	private renderTaskDeleteConfirm(card: Element, taskId: string, label: string): void {
		const fullTaskEntries = this.getEntries().filter((entry) => entry.taskId === taskId);
		const totalMs = fullTaskEntries.reduce((sum, entry) => sum + ((entry.end ?? Date.now()) - entry.start), 0);

		const confirm = card.createDiv({ cls: "task-time-tracker-log-edit-form" });
		confirm.createDiv({ text: label, cls: "task-time-tracker-log-task" });

		// QA — a diferencia de la tarjeta normal (que omite la fila si no
		// hay proyecto), aqui se muestra siempre, explicito, por ser el paso
		// previo a una accion irreversible (ver renderProjectRow()).
		// alignWithNoteIcon=false: este titulo no tiene icono de nota
		// delante (a diferencia del de la tarjeta), asi que la fila debe
		// alinearse a ras, sin el hueco de columna reservado para ese icono.
		this.renderProjectRow(confirm, this.actions.getProjectForTask(taskId), false);

		const meta = confirm.createDiv({ cls: "task-time-tracker-log-meta" });
		meta.createSpan({
			text: `${fullTaskEntries.length} ${fullTaskEntries.length === 1 ? t("log.session.singular") : t("log.session.plural")}`,
			cls: "task-time-tracker-log-session-count",
		});
		// Mismo total agregado que la cabecera de la tarjeta (misma clase
		// CSS), formato compacto — ver formatDurationCompact(). Sin icono:
		// a diferencia de la tarjeta normal, esta confirmacion nunca puede
		// tener la sesion activa (requestDeleteTask() bloquea el borrado si
		// la hay), asi que el icono de "sumando en vivo" nunca aplicaria
		// aqui.
		const totalGroup = meta.createSpan({ cls: "task-time-tracker-totals-duration-group" });
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
		const cancelBtn = actions.createEl("button", { text: t("log.cancel") });
		cancelBtn.addEventListener("click", () => {
			this.taskDeleteConfirmId = null;
			void this.render();
		});
		// Foco por defecto en "Cancelar", nunca en el boton destructivo —
		// evita un borrado accidental con Enter (Fase 5). Diferido con
		// setTimeout: el trigger es ahora el item "Delete" de un Menu (ver
		// openTaskMenu()), y ese Menu puede devolver el foco a su propio
		// boton disparador (el kebab) como parte de su propio cierre
		// DESPUES de que este render() termine — sin el defer, esa
		// devolucion de foco llegaba despues y pisaba el foco puesto aqui
		// (regresion detectada en la ronda 2 de QA).
		window.setTimeout(() => cancelBtn.focus(), 0);

		// Solo lectura a proposito: en la confirmacion de borrar la tarea
		// entera no hay ninguna via de edicion — se llama renderSessionInfo()
		// directamente (mismos datos: fecha, hora inicio, hora fin,
		// duracion), sin listener de clic ni botones.
		const detail = confirm.createDiv({ cls: "task-time-tracker-log-card-detail" });
		for (const entry of [...fullTaskEntries].sort((a, b) => b.start - a.start)) {
			const row = detail.createDiv({ cls: "task-time-tracker-log-session-row" });
			renderSessionInfo(row, entry, (el, completedMs, start) =>
				this.activeCardTicks.push({ kind: "duration", el, completedMs, start }),
			);
		}
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

	// Rediseno de cabecera (Selector de fecha, agosto 2026 — version
	// definitiva aportada por el usuario via Time Tracker.dc.html; version
	// de fila UNICA corregida en la 3a pasada de QA visual del rediseno
	// visual del Historial — la primera implementacion la partio en dos
	// filas por error, el prototipo real usa una sola, ver Time Tracker
	// Tab.dc.html lineas 59-76) — toggle Dia/Semana + Hoy + flechas+fecha,
	// todo en la misma linea, con calendario y Filter al final de esa
	// misma fila (margin-left: auto). En modo Resultados (ver [[Vista de
	// resultados por rango]]) el toggle y "Hoy" se ocultan (no tiene
	// sentido "avanzar" un rango arbitrario) y "Volver" ocupa el lugar de
	// las flechas+fecha; calendario y Filter mantienen su posicion.
	private renderDateNav(container: Element): void {
		const nav = container.createDiv({ cls: "task-time-tracker-log-datenav" });

		const row = nav.createDiv({ cls: "task-time-tracker-log-datenav-row" });

		if (this.viewMode !== "results") {
			const modeToggle = row.createDiv({ cls: "task-time-tracker-log-datenav-mode" });
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

			const todayBtn = row.createEl("button", {
				text: t("log.today"),
				cls: "task-time-tracker-log-datenav-today",
			});
			todayBtn.addEventListener("click", () => {
				// "Hoy" siempre lleva a la vista diaria de hoy, incluso si se
				// pulsa desde vista semanal — no solo mueve la fecha dentro del
				// modo activo.
				this.viewMode = "day";
				this.anchorDate = startOfDay(Date.now());
				void this.render();
			});
		}

		if (this.viewMode === "results") {
			// Sustituye a las flechas+fecha en su misma posicion de la fila —
			// "Volver" lleva siempre a vista Dia con la fecha de hoy (no
			// recuerda si se venia de Dia o Semana; mismo destino que
			// "Limpiar" del date-picker en este modo, ver
			// DatePickerPopover.ts#goToToday).
			const backBtn = row.createEl("button", { cls: "task-time-tracker-log-results-back" });
			setIcon(backBtn.createSpan(), "arrow-left");
			backBtn.createSpan({ text: t("log.resultsBack") });
			backBtn.addEventListener("click", () => {
				this.viewMode = "day";
				this.anchorDate = startOfDay(Date.now());
				void this.render();
			});
		} else {
			const range = row.createDiv({ cls: "task-time-tracker-log-datenav-range" });
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

		// margin-left: auto (ver CSS) empuja este boton y todo lo que va
		// despues (el filtro) juntos al extremo derecho de la fila, sin
		// separarlos entre si — calendario y Filter van pegados.
		const calendarBtn = row.createEl("button", {
			cls: "task-time-tracker-log-datenav-calendar task-time-tracker-log-header-icon-btn task-time-tracker-icon-btn",
		});
		// "Filtro de fecha activo" no es un estado propio separado (a
		// diferencia del filtro de proyecto, la navegacion por fecha
		// siempre muestra algun dia/semana, nunca "ninguno") — se deriva de
		// si el panel esta mostrando algo distinto de "hoy en vista Dia".
		// Mismo tratamiento visual (is-active) que el boton de filtro
		// cuando hay proyecto seleccionado, para que el usuario note de un
		// vistazo que no esta viendo la fecha por defecto. Sin pill de
		// texto (a diferencia del filtro): la fecha ya se muestra en la
		// fila de abajo, mostrarla tambien aqui la duplicaria.
		const isDateFilterActive = !(this.viewMode === "day" && isSameLocalDay(this.anchorDate, startOfDay(Date.now())));
		calendarBtn.toggleClass("is-active", isDateFilterActive);
		setIcon(calendarBtn, "calendar");
		calendarBtn.setAttribute("aria-label", t("log.datePickerAriaLabel"));
		setTooltip(calendarBtn, t("log.datePickerAriaLabel"));
		calendarBtn.addEventListener("click", () => {
			openDatePickerPopover({
				anchorEl: calendarBtn,
				selectedDate: this.anchorDate,
				// El picker no distingue "click en el numero de semana" de
				// "rango de dias que resulta ser justo una semana" — ambos
				// llegan aqui como el mismo (start, end), y da igual: los
				// dos deben saltar a vista Semana. Cualquier otro rango (ni
				// un solo dia ni una semana completa) entra en modo
				// Resultados — ver renderResultsSection().
				onChange: (start, end) => {
					if (start === end) {
						this.viewMode = "day";
						this.anchorDate = start;
						void this.render();
					} else if (start === startOfWeek(start) && end === addDays(start, 6)) {
						this.viewMode = "week";
						this.anchorDate = start;
						void this.render();
					} else {
						this.viewMode = "results";
						this.resultsRangeStart = start;
						this.resultsRangeEnd = end;
						this.resultsLoadedPages = 1;
						void this.render();
					}
				},
			});
		});

		this.renderProjectFilter(row);
	}

	// Boton de filtro por proyecto, junto al calendario: solo icono
	// "filter" en reposo (mismo aspecto que el boton de calendario — ver
	// .task-time-tracker-log-header-icon-btn), nombre del proyecto
	// seleccionado (o "No project") + fondo tintado en estado activo. El
	// icono "x" para quitar el filtro es un boton independiente (hit-area
	// propia), solo presente en estado activo — separado a proposito del
	// boton principal, que solo abre/cierra el popover.
	private renderProjectFilter(nav: HTMLElement): void {
		const wrap = nav.createDiv({ cls: "task-time-tracker-log-filter" });
		const activeProject = this.projectFilterId
			? (this.actions.getProjects().find((p) => p.id === this.projectFilterId) ?? null)
			: null;
		const isActive = activeProject !== null || this.projectFilterNoProject;

		const filterBtn = wrap.createEl("button", {
			cls: "task-time-tracker-log-filter-btn task-time-tracker-log-header-icon-btn task-time-tracker-icon-btn",
		});
		filterBtn.toggleClass("is-active", isActive);
		filterBtn.setAttribute("aria-label", t("log.filterButton"));
		setTooltip(filterBtn, t("log.filterButton"));
		setIcon(filterBtn.createSpan(), "filter");
		// Sin selección: solo el icono (mismo aspecto que el boton de
		// calendario). Con selección: nombre del proyecto o "No project",
		// igual que ya mostraba antes — el icono solo es exclusivo del
		// reposo, no del estado activo.
		if (isActive) {
			filterBtn.createSpan({
				text: activeProject ? activeProject.name : t("log.editModalNoProject"),
				cls: "task-time-tracker-log-filter-btn-label",
			});
		}
		filterBtn.addEventListener("click", () => {
			openProjectPickerPopover({
				anchorEl: filterBtn,
				projects: this.actions.getProjects(),
				selectedId: this.projectFilterId,
				showClearOption: false,
				showNoProjectFilterOption: true,
				noProjectFilterSelected: this.projectFilterNoProject,
				onSelect: (projectId) => {
					this.projectFilterId = projectId;
					this.projectFilterNoProject = projectId === null;
					void this.render();
				},
			});
		});

		if (isActive) {
			const clearBtn = wrap.createEl("button", {
				cls: "task-time-tracker-log-filter-clear task-time-tracker-icon-btn clickable-icon",
			});
			setIcon(clearBtn, "x");
			clearBtn.setAttribute("aria-label", t("log.filterClearAriaLabel"));
			setTooltip(clearBtn, t("log.filterClearAriaLabel"));
			clearBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this.projectFilterId = null;
				this.projectFilterNoProject = false;
				void this.render();
			});
		}
	}

	// Sustituye al estado vacio normal de dia/semana solo cuando hay un
	// filtro de proyecto activo y el rango visible completo (el dia, o
	// los 7 dias de la semana) no tiene ninguna sesion de ese proyecto —
	// un dia suelto vacio dentro de una semana con resultados en otros
	// dias sigue mostrando el "No sessions this day" normal (ver render()).
	private renderFilteredEmptyState(container: Element): void {
		const projectName = this.projectFilterNoProject
			? t("log.editModalNoProject")
			: (this.actions.getProjects().find((p) => p.id === this.projectFilterId)?.name ?? "");
		const key = this.viewMode === "day" ? "log.filterEmptyDay" : "log.filterEmptyWeek";

		const wrap = container.createDiv({ cls: "task-time-tracker-log-filter-empty" });
		wrap.createEl("p", { text: t(key, { project: projectName }), cls: "task-time-tracker-log-empty-day" });
		const clearBtn = wrap.createEl("button", { text: t("log.filterRemoveButton") });
		clearBtn.addEventListener("click", () => {
			this.projectFilterId = null;
			this.projectFilterNoProject = false;
			void this.render();
		});
	}

	// Formato corto de fecha (dia): "Mié, 12 ago 2026" en vez de la forma
	// larga anterior ("miércoles, 12 de agosto de 2026") — la barra de
	// navegacion ya no necesita competir en ancho con el toggle y el
	// boton Hoy en la misma linea. Intl da el nombre de dia/mes en
	// minuscula (locale es); solo la primera letra se pone en mayuscula
	// a mano, no toda la cadena (text-transform: capitalize la pondria
	// tambien en "ago").
	private formatRangeLabel(): string {
		if (this.viewMode === "day") {
			const label = new Date(this.anchorDate).toLocaleDateString(undefined, {
				weekday: "short",
				day: "numeric",
				month: "short",
				year: "numeric",
			});
			return label.charAt(0).toUpperCase() + label.slice(1);
		}
		const weekStart = startOfWeek(this.anchorDate);
		const weekEnd = addDays(weekStart, 6);
		return `${new Date(weekStart).toLocaleDateString()} – ${new Date(weekEnd).toLocaleDateString()}`;
	}

	// Bug de QA (5a pasada visual) — CSS text-transform: capitalize (ya
	// retirado, ver styles.css) capitaliza CADA palabra, no solo la
	// primera: en es-ES da "Martes, 18 De Agosto" en vez de "Martes, 18 de
	// agosto". Mismo criterio ya usado en formatRangeLabel(): Intl da el
	// nombre de dia/mes en minuscula (locale es), solo la primera letra se
	// pone en mayuscula a mano.
	private formatDayHeading(dayStart: number): string {
		const label = new Date(dayStart).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
		return label.charAt(0).toUpperCase() + label.slice(1);
	}

	// Rediseno visual del Historial (agosto 2026, Time Tracker Tab.dc.html) —
	// cabecera de cada dia dentro de Semana/Resultados: titulo + linea
	// conectora que rellena el espacio + total del dia a la derecha, en vez
	// del <h6> suelto de antes. dayEntries vacio (solo llega asi desde
	// Semana — Resultados nunca llama aqui con un dia vacio, ver
	// renderDaySection#hideIfEmpty) muestra "—" atenuado en vez de un total
	// real. Sigue siendo un <h6> real (semantica de encabezado para lector
	// de pantalla), con el layout de fila resuelto por CSS.
	private renderDayHeading(container: Element, dayStart: number, dayEntries: TimeEntry[]): void {
		const isEmpty = dayEntries.length === 0;
		const heading = container.createEl("h6", { cls: "task-time-tracker-log-day-heading" });
		heading.toggleClass("is-empty", isEmpty);
		heading.createSpan({ text: this.formatDayHeading(dayStart), cls: "task-time-tracker-log-day-heading-title" });
		heading.createDiv({ cls: "task-time-tracker-log-day-heading-line" });
		const totalEl = heading.createSpan({ cls: "task-time-tracker-log-day-heading-total" });

		if (isEmpty) {
			totalEl.setText("—");
			return;
		}

		const activeEntry = dayEntries.find((entry) => entry.end === null) ?? null;
		const completedMs = dayEntries
			.filter((entry) => entry.end !== null)
			.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
		const totalMs = completedMs + (activeEntry ? Date.now() - activeEntry.start : 0);
		// Icono solo si ESTE dia tiene la sesion activa (mismo criterio que
		// renderTaskCard() y renderViewTotal()) — indicador de "en vivo", no
		// decoracion fija.
		if (activeEntry) {
			setIcon(totalEl.createSpan({ cls: "task-time-tracker-log-day-heading-total-icon" }), "timer");
		}
		const valueEl = totalEl.createSpan({ text: formatDurationCompact(totalMs) });

		if (activeEntry) {
			this.activeCardTicks.push({
				kind: "total",
				el: valueEl,
				completedMs,
				start: activeEntry.start,
				lastMinute: Math.floor(totalMs / 60000),
			});
		}
	}

	// Limites (inicio incluido, fin excluido) del rango actualmente visible,
	// segun viewMode — mismo calculo que ya hacia renderViewTotal() por su
	// cuenta, ahora compartido con renderSubtitle() (ver rediseno visual del
	// Historial, agosto 2026: subtitulo "N tareas · M sesiones/dias").
	private getViewRangeBounds(): { start: number; end: number } {
		if (this.viewMode === "results") {
			return { start: this.resultsRangeStart as number, end: addDays(this.resultsRangeEnd as number, 1) };
		}
		const start = this.viewMode === "day" ? startOfDay(this.anchorDate) : startOfWeek(this.anchorDate);
		const end = this.viewMode === "day" ? addDays(start, 1) : addDays(start, 7);
		return { start, end };
	}

	// Subtitulo bajo "Time Tracker" (rediseno visual del Historial, agosto
	// 2026): "N tareas · M sesiones" en Dia, "N tareas · M dias con
	// actividad" en Semana/Resultados — nunca "N tareas · 1 dia con
	// actividad" en Dia, ver la nota de diseno (dato trivial en un solo
	// dia). allEntries ya llega acotado por el filtro de proyecto (ver
	// render()), aqui solo se acota ademas al rango de fecha visible.
	private renderSubtitle(container: Element, allEntries: TimeEntry[]): void {
		const { start, end } = this.getViewRangeBounds();
		const rangeEntries = allEntries.filter((entry) => entry.start >= start && entry.start < end);
		const taskCount = new Set(rangeEntries.map((entry) => entry.taskId)).size;
		const taskWord = taskCount === 1 ? t("log.task.singular") : t("log.task.plural");

		let text: string;
		if (this.viewMode === "day") {
			const sessionWord = rangeEntries.length === 1 ? t("log.session.singular") : t("log.session.plural");
			text = `${taskCount} ${taskWord} · ${rangeEntries.length} ${sessionWord}`;
		} else {
			const activeDays = new Set(rangeEntries.map((entry) => startOfDay(entry.start))).size;
			const dayWord = activeDays === 1 ? t("log.dayWithActivity.singular") : t("log.dayWithActivity.plural");
			text = `${taskCount} ${taskWord} · ${activeDays} ${dayWord}`;
		}

		container.createDiv({ text, cls: "task-time-tracker-log-subtitle" });
	}

	// Bloque 2 — una seccion por dia: filtra allEntries a las que empezaron
	// (entry.start) ese dia calendario local, y muestra un estado vacio
	// razonable si no hay ninguna. withHeading solo se usa en vista semanal
	// y en Resultados (una seccion por dia); en vista diaria el titulo de
	// la seccion ya lo da la barra de navegacion, asi que no hace falta
	// repetirlo. hideIfEmpty (Resultados, ver renderResultsSection()): un
	// dia sin sesiones no se muestra en absoluto, ni siquiera su
	// cabecera — es una lista de resultados, no un calendario, a
	// diferencia de Semana, donde SI se muestra la cabecera + "No
	// sessions this day" para cada dia vacio.
	private async renderDaySection(
		container: Element,
		dayStart: number,
		allEntries: TimeEntry[],
		withHeading: boolean,
		token: number,
		hideIfEmpty = false,
	): Promise<void> {
		const dayEntries = allEntries
			.filter((entry) => isSameLocalDay(entry.start, dayStart))
			.sort((a, b) => a.start - b.start);

		if (dayEntries.length === 0) {
			if (hideIfEmpty) return;
			if (withHeading) {
				this.renderDayHeading(container, dayStart, dayEntries);
			}
			container.createEl("p", { text: t("log.emptyDay"), cls: "task-time-tracker-log-empty-day" });
			return;
		}

		if (withHeading) {
			this.renderDayHeading(container, dayStart, dayEntries);
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

		if (allEntries.length === 0) {
			container.createEl("h4", { text: t("log.title") });
			container.createEl("p", { text: t("log.emptyAll") });
			return;
		}

		// Filtro por proyecto (ver renderProjectFilter()): acota TODO el
		// listado visible (total de la cabecera, navegacion incluida) a las
		// entries de tareas asignadas a ese proyecto — allEntries (sin
		// filtrar) se conserva arriba solo para decidir el estado vacio
		// global del plugin ("No sessions recorded yet"), que no tiene
		// relacion con el filtro.
		const visibleEntries = this.projectFilterNoProject
			? allEntries.filter((entry) => this.actions.getProjectForTask(entry.taskId) === null)
			: this.projectFilterId
				? allEntries.filter((entry) => this.actions.getProjectForTask(entry.taskId)?.id === this.projectFilterId)
				: allEntries;

		const titleRow = container.createDiv({ cls: "task-time-tracker-log-title-row" });
		const titleCol = titleRow.createDiv({ cls: "task-time-tracker-log-title-col" });
		titleCol.createEl("h4", { text: t("log.title") });
		this.renderSubtitle(titleCol, visibleEntries);
		this.renderViewTotal(titleRow, visibleEntries);

		this.renderDateNav(container);

		if (this.viewMode === "results") {
			await this.renderResultsSection(container, visibleEntries, token);
			return;
		}

		const rangeStart = this.viewMode === "day" ? startOfDay(this.anchorDate) : startOfWeek(this.anchorDate);
		const rangeEnd = this.viewMode === "day" ? addDays(rangeStart, 1) : addDays(rangeStart, 7);
		const rangeHasEntries = visibleEntries.some((entry) => entry.start >= rangeStart && entry.start < rangeEnd);

		if ((this.projectFilterId || this.projectFilterNoProject) && !rangeHasEntries) {
			this.renderFilteredEmptyState(container);
		} else if (this.viewMode === "day") {
			await this.renderDaySection(container, rangeStart, visibleEntries, false, token);
		} else {
			for (let i = 0; i < 7; i++) {
				if (token !== this.renderToken) return;
				await this.renderDaySection(container, addDays(rangeStart, i), visibleEntries, true, token);
			}
		}
	}

	// Vista de resultados por rango: agrupado por dia (cabecera + tarjetas,
	// ver renderDaySection con hideIfEmpty), sin dias vacios intercalados.
	// Paginado en bloques de RESULTS_PAGE_DAYS dias — un rango puede ser
	// arbitrariamente amplio (sin limite en el date-picker), pero resolver
	// de golpe cientos/miles de dias (la inmensa mayoria vacios) no tiene
	// sentido; "Cargar mas" solo aparece si el rango completo excede lo ya
	// cargado. El total de la fila de titulo (ver renderViewTotal) SIEMPRE
	// cubre el rango completo, no solo lo cargado — se calcula aparte, no
	// depende de este bucle.
	private async renderResultsSection(container: Element, visibleEntries: TimeEntry[], token: number): Promise<void> {
		const rangeStart = this.resultsRangeStart as number;
		const rangeEnd = this.resultsRangeEnd as number; // dia de inicio del ultimo dia (inclusive)
		const rangeEndExclusive = addDays(rangeEnd, 1);

		const rangeHasEntries = visibleEntries.some((entry) => entry.start >= rangeStart && entry.start < rangeEndExclusive);
		if (!rangeHasEntries) {
			this.renderResultsEmptyState(container, rangeStart, rangeEnd);
			return;
		}

		const totalDays = Math.round((rangeEndExclusive - rangeStart) / 86400000);
		const loadedDays = Math.min(this.resultsLoadedPages * RESULTS_PAGE_DAYS, totalDays);

		for (let i = 0; i < loadedDays; i++) {
			if (token !== this.renderToken) return;
			await this.renderDaySection(container, addDays(rangeStart, i), visibleEntries, true, token, true);
		}

		if (loadedDays < totalDays) {
			const loadMoreWrap = container.createDiv({ cls: "task-time-tracker-log-results-load-more" });
			const loadMoreBtn = loadMoreWrap.createEl("button", { text: t("log.resultsLoadMore") });
			loadMoreBtn.addEventListener("click", () => {
				this.resultsLoadedPages += 1;
				void this.render();
			});
		}
	}

	// "Quitar filtro" hace lo mismo que "Volver"/"Limpiar" en este modo
	// (ver [[Vista de resultados por rango]]#"Limpiar" en modo Resultados):
	// no hay un filtro de proyecto que quitar aqui especificamente (a
	// diferencia de renderFilteredEmptyState, que si distingue esa causa) —
	// un rango vacio, con o sin filtro de proyecto combinado, tiene un unico
	// mensaje y una unica salida: abandonar el rango.
	private renderResultsEmptyState(container: Element, rangeStart: number, rangeEnd: number): void {
		const sameMonth =
			new Date(rangeStart).getMonth() === new Date(rangeEnd).getMonth() &&
			new Date(rangeStart).getFullYear() === new Date(rangeEnd).getFullYear();
		const startLabel = sameMonth ? String(new Date(rangeStart).getDate()) : formatShortDate(rangeStart);
		const endLabel = formatShortDate(rangeEnd);

		const wrap = container.createDiv({ cls: "task-time-tracker-log-results-empty" });
		const textEl = wrap.createEl("p", { cls: "task-time-tracker-log-results-empty-text" });
		textEl.createSpan({ text: `${t("log.resultsEmptyPrefix")} ` });
		textEl.createSpan({
			text: `${startLabel} ${t("log.resultsEmptyJoiner")} ${endLabel}`,
			cls: "task-time-tracker-log-results-empty-range",
		});

		const clearBtn = wrap.createEl("button", { text: t("log.filterRemoveButton") });
		clearBtn.addEventListener("click", () => {
			this.viewMode = "day";
			this.anchorDate = startOfDay(Date.now());
			void this.render();
		});
	}

	// Total de tiempo trackeado en la vista actual (dia, semana o el rango
	// completo de Resultados — nunca solo la parte ya cargada si hay
	// paginacion, ver renderResultsSection()), junto al titulo. A
	// diferencia del total compacto de cada tarjeta (formatDurationCompact),
	// aqui se usa formatDuration (HH:MM:SS): es un unico numero destacado,
	// no una lista de totales por tarea donde el formato compacto evita
	// que compita visualmente con el titulo de cada tarjeta.
	private renderViewTotal(container: Element, allEntries: TimeEntry[]): void {
		const { start: rangeStart, end: rangeEnd } = this.getViewRangeBounds();
		const viewEntries = allEntries.filter((entry) => entry.start >= rangeStart && entry.start < rangeEnd);

		const activeEntry = viewEntries.find((entry) => entry.end === null) ?? null;
		const completedMs = viewEntries
			.filter((entry) => entry.end !== null)
			.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
		const totalMs = completedMs + (activeEntry ? Date.now() - activeEntry.start : 0);

		// Etiqueta "Total del rango" (rediseno visual del Historial, agosto
		// 2026): mismo dato de siempre (el total del rango visible, sube en
		// vivo si hay sesion activa), solo se le añade el rotulo encima —
		// util sobre todo en Resultados, sin "hoy"/"esta semana" implicitos.
		const totalCol = container.createDiv({ cls: "task-time-tracker-log-total-col" });
		totalCol.createSpan({ text: t("log.rangeTotalLabel"), cls: "task-time-tracker-log-total-label" });
		const totalGroup = totalCol.createSpan({ cls: "task-time-tracker-totals-duration-group" });
		// Icono solo si la sesion activa cae dentro del rango visible — ver
		// mismo criterio en renderTaskCard() y renderDayHeading().
		if (activeEntry) {
			setIcon(totalGroup.createSpan({ cls: "task-time-tracker-totals-duration-icon" }), "clock");
		}
		// task-time-tracker-log-view-total-value: escala grande (22px en el
		// prototipo) exclusiva de este total de cabecera — la clase base
		// task-time-tracker-totals-duration se queda en la escala pequeña
		// que comparten la tarjeta de tarea y la confirmacion de borrado.
		const value = totalGroup.createSpan({
			text: formatDuration(totalMs),
			cls: "task-time-tracker-totals-duration task-time-tracker-log-view-total-value",
		});

		if (activeEntry) {
			this.activeCardTicks.push({ kind: "duration", el: value, completedMs, start: activeEntry.start });
		}
	}
}
