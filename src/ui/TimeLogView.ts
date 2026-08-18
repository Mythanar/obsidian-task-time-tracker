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
import { EditTaskModal } from "./EditTaskModal";
import { InlineTrackingBus } from "./InlineTrackingBus";
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

type LogViewMode = "day" | "week";

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

		// Columna de icono de ancho fijo (task-time-tracker-log-card-icon-col,
		// ver styles.css), repetida en las filas de la cabecera — nota en la
		// fila 1, chevron en la fila de sesiones — para que el titulo y "N
		// sessions..." arranquen siempre en el mismo margen izquierdo, tenga
		// o no icono de nota esta tarea (isMissing).
		const titleRow = header.createDiv({ cls: "task-time-tracker-log-card-title-row" });
		const noteCol = titleRow.createDiv({ cls: "task-time-tracker-log-card-icon-col" });
		if (!isMissing) {
			// Zona 1 — unico punto de navegacion hacia la nota; hit-area e
			// hijos propios, no interfiere con el titulo ni con el kebab.
			const noteBtn = noteCol.createEl("button", {
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
			// Tarea "no encontrada": mismo hueco (noteCol) y mismas clases
			// que el icono de nota normal, para no romper la alineacion del
			// titulo entre tarjetas — solo cambia el icono y la accion al
			// clic, que ya no puede abrir una nota que no existe.
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

		// Titulo: sin hover ni accion de clic propia (la navegacion vive
		// solo en el icono de arriba) — solo tooltip con el texto completo
		// en desktop si esta truncado.
		const title = titleRow.createDiv({ text: label, cls: "task-time-tracker-log-task" });
		if (isMissing) {
			title.addClass("task-time-tracker-log-task-missing");
		}

		// Zona 2 — menu kebab, siempre visible, no depende de expandir la
		// tarjeta ni de hover de fila.
		const menuBtn = titleRow.createEl("button", {
			cls: "task-time-tracker-log-card-menu task-time-tracker-icon-btn clickable-icon",
		});
		setIcon(menuBtn, "more-vertical");
		menuBtn.setAttribute("aria-label", t("log.taskMenuAriaLabel"));
		setTooltip(menuBtn, t("log.taskMenuAriaLabel"));
		menuBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.openTaskMenu(menuBtn, taskId, label);
		});

		// Medir DESPUES de que title y menuBtn (hermanos en el mismo flex
		// row) esten ambos insertados — ver comentario detallado sobre este
		// mismo bug en renderProjectRow() mas abajo, donde se detecto:
		// medir un span antes de que su hermano en la fila exista da un
		// clientWidth mas generoso de lo que sera una vez el hermano ocupe
		// su espacio, y el helper decide (con datos aun no definitivos) que
		// no hace falta tooltip.
		this.applyTruncationTooltip(title, label);

		if (isMissing) {
			const mostRecent = taskEntries.reduce((latest, entry) => (entry.start > latest.start ? entry : latest));
			header.createDiv({ text: mostRecent.taskText, cls: "task-time-tracker-log-task-snapshot" });
		}

		// Fila 2 — Proyecto/Cliente: solo si hay proyecto asignado (vinculo
		// vivo por tt-id, ver ProjectManager#getProjectForTask). Sin hover
		// ni accion de clic; reasignar vive dentro del modal de Editar.
		if (project) {
			this.renderProjectRow(header, project);
		}

		// Zona 3 — linea de sesiones: chevron + nº sesiones + total + tt-id,
		// envueltos en su propia pildora clicable que expande/colapsa el
		// detalle de solo lectura. El boton de stop de tracking activo (si
		// lo hay) vive fuera de esa pildora, en la misma fila.
		const meta = header.createDiv({ cls: "task-time-tracker-log-meta" });
		const sessionsToggle = meta.createDiv({ cls: "task-time-tracker-log-card-sessions-toggle" });
		sessionsToggle.toggleClass("is-expanded", expanded);
		sessionsToggle.addEventListener("click", () => {
			if (expanded) {
				this.expandedTaskIds.delete(expandKey);
			} else {
				this.expandedTaskIds.add(expandKey);
				this.pendingScrollKey = expandKey;
			}
			void this.render();
		});
		const toggleCol = sessionsToggle.createDiv({ cls: "task-time-tracker-log-card-icon-col" });
		const toggleIcon = toggleCol.createSpan({ cls: "task-time-tracker-log-card-toggle" });
		toggleIcon.setAttribute("aria-hidden", "true");
		setIcon(toggleIcon, "chevron-right");
		sessionsToggle.createSpan({
			text: `${taskEntries.length} ${taskEntries.length === 1 ? t("log.session.singular") : t("log.session.plural")}`,
			cls: "task-time-tracker-log-session-count",
		});
		// Total agregado (varias sesiones sumadas): formato compacto, no
		// HH:MM:SS — ver formatDurationCompact(). Icono de cronometro +
		// valor agrupados (task-time-tracker-totals-duration-group) para
		// que el numero compita visualmente con el titulo en vez de
		// perderse entre el resto de metadatos de la cabecera.
		const totalGroup = sessionsToggle.createSpan({ cls: "task-time-tracker-totals-duration-group" });
		setIcon(totalGroup.createSpan({ cls: "task-time-tracker-totals-duration-icon" }), "timer");
		const totalDuration = totalGroup.createSpan({
			text: formatDurationCompact(totalMs),
			cls: "task-time-tracker-totals-duration",
		});
		sessionsToggle.createSpan({ text: taskId, cls: "task-time-tracker-log-taskid" });

		if (activeEntry) {
			// Boton de stop con contador en vivo, mismo patron de pill que el
			// badge junto al checkbox (icono relleno + numero en
			// monoespaciada). completedMs es la suma de las sesiones YA
			// cerradas de esta tarjeta; el tick de cada segundo (via el bus)
			// le suma el tiempo transcurrido desde activeEntry.start. Fuera de
			// alcance de este rediseno — sin cambios de comportamiento.
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

	// Icono maletin (proyecto) + icono persona (cliente, si tiene). Mismo
	// hueco de columna que el icono de nota (task-time-tracker-log-card-icon-col)
	// para alinear con el titulo — pero SOLO en la tarjeta normal, cuyo
	// titulo tiene ese mismo hueco delante (icono de nota). alignWithNoteIcon
	// desactiva ese hueco para la confirmacion de borrado (ver abajo), cuyo
	// titulo no lleva icono delante: con el hueco puesto ahi, la fila
	// quedaba indentada sin motivo respecto al titulo (bug de QA, ronda 2).
	// Sin hover, sin accion de clic — reasignar vive dentro del modal de
	// Editar (Zona 2, kebab -> Editar).
	// project null: solo ocurre cuando llama renderTaskDeleteConfirm() (ver
	// abajo) — a diferencia de la tarjeta normal, que omite la fila entera
	// si no hay proyecto asignado, la confirmacion de borrado lo muestra
	// explicito ("No project") por ser el paso previo a una accion
	// irreversible, donde preferimos explicito sobre implicito.
	private renderProjectRow(header: HTMLElement, project: Project | null, alignWithNoteIcon = true): void {
		const row = header.createDiv({ cls: "task-time-tracker-log-card-project-row" });
		if (alignWithNoteIcon) {
			row.createDiv({ cls: "task-time-tracker-log-card-icon-col" });
		}

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
	// realmente truncado por CSS (scrollWidth > clientWidth) y solo en
	// desktop — en mobile no hay hover, asi que no hay donde mostrarlo (ver
	// rediseno "Editar tarea desde el Historial"). Se llama de forma
	// sincrona justo tras insertar `el` en un DOM ya adjunto (la tarjeta
	// vive dentro del panel visible desde antes de este punto), asi que el
	// layout ya esta resuelto al leer estas propiedades — no hace falta
	// esperar (leer clientWidth/scrollWidth fuerza un reflow sincrono si
	// hiciera falta). El requisito real es que `el` mismo tenga una caja
	// con overflow:hidden/text-overflow:ellipsis (ver
	// .task-time-tracker-log-card-project-name en styles.css): un <span>
	// sin esas reglas propias (display:inline puro) siempre da clientWidth
	// 0, asi que la comparacion nunca detecta truncamiento — bug de QA
	// corregido aplicando esas reglas al span de texto mismo, no a un
	// contenedor distinto.
	private applyTruncationTooltip(el: HTMLElement, fullText: string): void {
		if (Platform.isMobile) return;
		if (el.scrollWidth > el.clientWidth) setTooltip(el, fullText);
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

	// Bloque 2 / rediseno de cabecera — barra de navegacion de fecha: tres
	// bloques atomicos, siempre en el mismo orden en el DOM (toggle Dia/
	// Semana, rango de fecha, boton Hoy). En ventanas anchas caben los
	// tres en una sola linea con el rango en medio (unico con flex-grow,
	// ver .task-time-tracker-log-datenav-range en styles.css: crece para
	// ocupar el espacio libre entre toggle y Hoy, y centra su contenido
	// dentro de ese espacio). En ventanas estrechas (panel lateral,
	// mobile), el toggle y Hoy se agrupan en su propia linea (mismo
	// truco, pero via CSS order dentro de una @container query — no hay
	// combinacion de flex-wrap puro que agrupe "primero y tercero" sin
	// tocar el segundo) y el rango de fecha baja solo a la suya.
	private renderDateNav(container: Element): void {
		const nav = container.createDiv({ cls: "task-time-tracker-log-datenav" });

		const modeToggle = nav.createDiv({ cls: "task-time-tracker-log-datenav-mode" });
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

		const todayBtn = nav.createEl("button", {
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
			.sort((a, b) => a.start - b.start);

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

		if (allEntries.length === 0) {
			container.createEl("h4", { text: t("log.title") });
			container.createEl("p", { text: t("log.emptyAll") });
			return;
		}

		const titleRow = container.createDiv({ cls: "task-time-tracker-log-title-row" });
		titleRow.createEl("h4", { text: t("log.title") });
		this.renderViewTotal(titleRow, allEntries);

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

	// Total de tiempo trackeado en la vista actual (dia o semana),
	// junto al titulo. A diferencia del total compacto de cada tarjeta
	// (formatDurationCompact), aqui se usa formatDuration (HH:MM:SS): es
	// un unico numero destacado, no una lista de totales por tarea donde
	// el formato compacto evita que compita visualmente con el titulo de
	// cada tarjeta.
	private renderViewTotal(container: Element, allEntries: TimeEntry[]): void {
		const rangeStart = this.viewMode === "day" ? startOfDay(this.anchorDate) : startOfWeek(this.anchorDate);
		const rangeEnd = this.viewMode === "day" ? addDays(rangeStart, 1) : addDays(rangeStart, 7);
		const viewEntries = allEntries.filter((entry) => entry.start >= rangeStart && entry.start < rangeEnd);

		const activeEntry = viewEntries.find((entry) => entry.end === null) ?? null;
		const completedMs = viewEntries
			.filter((entry) => entry.end !== null)
			.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
		const totalMs = completedMs + (activeEntry ? Date.now() - activeEntry.start : 0);

		const totalGroup = container.createSpan({ cls: "task-time-tracker-totals-duration-group" });
		setIcon(totalGroup.createSpan({ cls: "task-time-tracker-totals-duration-icon" }), "clock");
		const value = totalGroup.createSpan({ text: formatDuration(totalMs), cls: "task-time-tracker-totals-duration" });

		if (activeEntry) {
			this.activeCardTicks.push({ kind: "duration", el: value, completedMs, start: activeEntry.start });
		}
	}
}
