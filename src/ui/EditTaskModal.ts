// ui/EditTaskModal.ts
// Rediseno "Editar tarea desde el Historial" (agosto 2026) — unica via de
// gestion de una tarea desde el Historial: reasignar Proyecto/Cliente
// (vinculo vivo por tt-id, ver core/ProjectManager.ts) y editar/borrar
// sesiones sueltas. El nombre de la tarea es puramente informativo (sin
// navegacion a la nota — eso vive solo en el icono file-search de la
// tarjeta, ver TimeLogView.ts) y el borrado de la tarea completa vive
// solo en el menu kebab de la tarjeta, nunca aqui.

import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import { formatDuration, formatDurationCompact } from "../core/TrackingEngine";
import { t } from "../i18n";
import { EntryUpdateResult, Project, TimeEntry } from "../types";
import { openProjectPickerPopover } from "./ProjectPickerList";
import {
	EditDraft,
	effectiveRange,
	formatDateInput,
	formatHMS,
	parseDateInput,
	parseTimeInput,
	rangesOverlap,
	renderSessionInfo,
	resolveDraftTimestamps,
} from "./sessionEdit";

export interface EditTaskModalActions {
	assignProject(taskId: string, projectId: string | null): Promise<void>;
	updateEntryTimes(entryId: string, start: number, end: number): Promise<EntryUpdateResult>;
	deleteEntry(entryId: string): Promise<void>;
}

export class EditTaskModal extends Modal {
	private editingEntryId: string | null = null;
	private draft: EditDraft | null = null;
	private sessionsEl: HTMLElement | null = null;
	private summaryEl: HTMLElement | null = null;
	private projectFeedbackEl: HTMLElement | null = null;
	private feedbackTimeoutId: number | null = null;
	private currentProjectId: string;
	// QA ronda 2 — no existe ningun hook publico documentado (ver
	// obsidian.d.ts#Modal) para desactivar el cierre al clicar fuera del
	// contenido. Unica via basada solo en API publica: detectar un
	// mousedown fuera de modalEl (containerEl/modalEl son ambos publicos)
	// y, durante una ventana muy breve despues, bloquear cualquier
	// close() en el propio override de abajo. Ni Esc ni el boton "Cerrar"
	// pasan nunca por un mousedown fuera del modal, asi que nunca activan
	// este bloqueo — no hace falta tocar su manejo, que ya funciona.
	private outsideMousedownGuardUntil = 0;

	constructor(
		app: App,
		private taskId: string,
		private label: string,
		// Bug 0.0.32 — nota borrada: `label` ya llega como el taskText real
		// (mismo snapshot que usa la tarjeta del Historial, ver
		// TimeLogView.ts#renderTaskCard), no el generico "Task not found"/
		// "Tarea no encontrada". Este flag solo controla el aviso adicional
		// "Note not found" bajo el titulo — no afecta a tt-id, Project ni
		// Sessions, que ya funcionan sin depender de la nota.
		private isMissing: boolean,
		// The full history of THIS task and the project list, both as
		// readers: the in-memory state is replaced wholesale after every
		// write (read-before-write, see core/StateStore.ts), so capturing
		// the array would leave orphan objects — and reading on demand also
		// makes a change delivered by sync visible on the next render.
		private getEntries: () => TimeEntry[],
		// Todas las entries del plugin (no solo las de esta tarea): el
		// aviso de solapamiento compara contra cualquier otra sesion, igual
		// que ya hacia la edicion inline de Fase 5.
		private getAllEntries: () => TimeEntry[],
		private getProjects: () => Project[],
		currentProject: Project | null,
		private actions: EditTaskModalActions,
		// Refresca el panel del Historial detras del modal tras cada
		// mutacion (reasignar proyecto, editar u borrar una sesion).
		private onChange: () => void,
	) {
		super(app);
		this.currentProjectId = currentProject?.id ?? "";
	}

	// Unico punto de cierre real permitido, aparte del guard de close()
	// abajo. Ver el comentario junto a outsideMousedownGuardUntil sobre
	// por que esto se resuelve asi (solo API publica).
	close(): void {
		if (Date.now() < this.outsideMousedownGuardUntil) return;
		super.close();
	}

	onOpen(): void {
		const { contentEl } = this;
		// En modalEl (no contentEl): modal-title vive en modal-header, un
		// hermano de modal-content, asi que el selector CSS de este modal
		// (ver .task-time-tracker-edit-modal .modal-title en styles.css)
		// necesita un ancestro comun a ambos para alcanzar el titulo.
		this.modalEl.addClass("task-time-tracker-edit-modal");

		this.containerEl.addEventListener(
			"mousedown",
			(evt) => {
				if (!this.modalEl.contains(evt.target as Node)) {
					this.outsideMousedownGuardUntil = Date.now() + 300;
				}
			},
			true,
		);

		// Correccion QA ronda 4: usar el titulo nativo del Modal (this.titleEl,
		// publico via setTitle()) en vez de un h3 propio dentro de contentEl.
		// Obsidian ya posiciona titleEl en la misma fila que su boton de
		// cerrar (X) dentro del modal-header — resuelve el desalineamiento
		// de raiz, sin necesidad de parchear un margin-top a mano.
		this.setTitle(this.label);

		// Bug 0.0.32 — nota borrada: aviso en cursiva bajo el titulo, distinto
		// del tratamiento de la tarjeta del Historial (ahi el nombre va en
		// cursiva; aqui es el titulo el que queda normal y este aviso el que
		// va en cursiva, ver encargo). No afecta a tt-id/Project/Sessions.
		if (this.isMissing) {
			contentEl.createDiv({ text: t("log.noteNotFound"), cls: "task-time-tracker-edit-modal-note-missing" });
		}

		// Metadato secundario (siempre visible, no sujeto a los niveles
		// Normal/Reducido/Oculto del tt-id renderizado en la nota via
		// Dataview — eso es un ajuste distinto sobre la nota, ver
		// SettingsTab.ts#taskIdFormat): id limpio (sin corchetes ni
		// "tt-id::", igual que la columna del CSV de exportacion, ver
		// CsvAdapter.ts) mas boton de copiar. Mismo estilo atenuado que ya
		// usa el subtitulo del panel (task-time-tracker-log-subtitle).
		const idRow = contentEl.createDiv({ cls: "task-time-tracker-edit-modal-id-row" });
		idRow.createSpan({ text: "tt-id", cls: "task-time-tracker-edit-modal-id-key" });
		idRow.createSpan({ text: this.taskId, cls: "task-time-tracker-edit-modal-id-value" });
		const copyIdBtn = idRow.createEl("button", {
			cls: "task-time-tracker-edit-modal-id-copy task-time-tracker-icon-btn clickable-icon",
		});
		setIcon(copyIdBtn, "copy");
		copyIdBtn.setAttribute("aria-label", t("log.editModalCopyIdAriaLabel"));
		copyIdBtn.addEventListener("click", () => {
			void navigator.clipboard.writeText(this.taskId).then(() => {
				new Notice(t("log.editModalIdCopied"));
			});
		});

		// Boton + popover (componente compartido "Project picker list", ver
		// ProjectPickerList.ts) en vez del <select> nativo anterior: label y
		// boton juntos, alineados a la izquierda.
		const projectRow = contentEl.createDiv({ cls: "task-time-tracker-edit-modal-project-row" });
		projectRow.createSpan({ text: t("log.editModalProjectLabel"), cls: "task-time-tracker-edit-modal-project-label" });
		const projectBtn = projectRow.createEl("button", {
			cls: "task-time-tracker-log-filter-btn task-time-tracker-edit-modal-project-btn",
		});
		setIcon(projectBtn.createSpan(), "briefcase");
		const projectBtnLabel = projectBtn.createSpan({ cls: "task-time-tracker-log-filter-btn-label" });
		this.updateProjectBtnLabel(projectBtnLabel);
		projectBtn.addEventListener("click", () => {
			// Guard permanente mientras el popover este abierto (no solo los
			// 300ms del detector automatico de arriba): el popover vive fuera
			// de modalEl (appendeado a document.body para poder posicionarse
			// con position: fixed), asi que buscar o clicar una fila dentro
			// de el se veria como un click "fuera del modal" y lo cerraria —
			// mismo problema que el <select> nativo que este boton reemplaza
			// (ver el comentario junto a outsideMousedownGuardUntil arriba).
			this.outsideMousedownGuardUntil = Number.MAX_SAFE_INTEGER;
			openProjectPickerPopover({
				anchorEl: projectBtn,
				projects: this.getProjects(),
				selectedId: this.currentProjectId || null,
				showClearOption: true,
				onSelect: (projectId) => {
					this.currentProjectId = projectId ?? "";
					this.updateProjectBtnLabel(projectBtnLabel);
					void this.actions.assignProject(this.taskId, projectId).then(() => {
						this.onChange();
						this.showProjectFeedback();
					});
				},
				onClose: () => {
					this.outsideMousedownGuardUntil = 0;
				},
			});
		});

		// Espacio reservado (una linea, ver styles.css min-height) desde el
		// primer render, vacio por defecto — evita que el aviso "Project
		// updated" al aparecer/desaparecer desplace el resto del modal.
		this.projectFeedbackEl = contentEl.createDiv({ cls: "task-time-tracker-edit-modal-project-feedback" });

		// QA ronda 3 — encabezado "Sessions" y resumen (nº sesiones + total)
		// comparten fila: titulo a la izquierda, resumen a la derecha. El
		// resumen usa el mismo formato/clases que ya usa la tarjeta del
		// panel — a proposito distinto del total de la tarjeta que abrio
		// este modal (esa esta acotada al dia/semana visible, ver Fase 5);
		// aqui es el historico completo de la tarea, coherente con el
		// resto del modal.
		const sessionsHeader = contentEl.createDiv({ cls: "task-time-tracker-edit-modal-sessions-header" });
		sessionsHeader.createEl("h4", { text: t("log.editModalSessionsHeading") });
		this.summaryEl = sessionsHeader.createDiv({ cls: "task-time-tracker-log-meta task-time-tracker-edit-modal-summary" });
		this.renderSummary();

		this.sessionsEl = contentEl.createDiv({ cls: "task-time-tracker-edit-modal-sessions" });
		this.renderSessions();
		// Al abrir, la sesion mas reciente (ultima en el orden cronologico
		// ascendente, ver renderSessions()) queda visible sin scroll manual —
		// solo en la apertura inicial, no en cada re-render tras editar.
		this.sessionsEl.scrollTop = this.sessionsEl.scrollHeight;

		new Setting(contentEl).addButton((button) =>
			button.setButtonText(t("log.close")).onClick(() => this.close()),
		);
	}

	onClose(): void {
		if (this.feedbackTimeoutId !== null) window.clearTimeout(this.feedbackTimeoutId);
		this.contentEl.empty();
	}

	// Feedback inline (no Notice global, no footer): escribe el aviso en el
	// espacio ya reservado y lo desvanece tras ~3s. Reinicia el temporizador
	// si se reasigna otra vez antes de que termine el anterior, para que dos
	// reasignaciones seguidas no se pisen a medio desvanecer.
	private showProjectFeedback(): void {
		const el = this.projectFeedbackEl;
		if (!el) return;
		if (this.feedbackTimeoutId !== null) {
			window.clearTimeout(this.feedbackTimeoutId);
			this.feedbackTimeoutId = null;
		}
		el.setText(t("log.editModalProjectUpdated"));
		el.addClass("is-visible");
		this.feedbackTimeoutId = window.setTimeout(() => {
			el.removeClass("is-visible");
			this.feedbackTimeoutId = null;
			// Limpia el texto solo tras el fade (ver transition en
			// styles.css) para no dejar un nodo de texto invisible pero
			// presente (accesibilidad) mas alla de lo necesario.
			window.setTimeout(() => el.setText(""), 300);
		}, 3000);
	}

	private updateProjectBtnLabel(el: HTMLElement): void {
		const project = this.getProjects().find((p) => p.id === this.currentProjectId);
		el.setText(project ? project.name : t("log.editModalNoProject"));
	}

	private renderSummary(): void {
		const el = this.summaryEl;
		if (!el) return;
		el.empty();

		const entries = this.getEntries();
		const totalMs = entries.reduce((sum, entry) => sum + ((entry.end ?? Date.now()) - entry.start), 0);
		el.createSpan({
			text: `${entries.length} ${entries.length === 1 ? t("log.session.singular") : t("log.session.plural")}`,
			cls: "task-time-tracker-log-session-count",
		});
		const totalGroup = el.createSpan({ cls: "task-time-tracker-totals-duration-group" });
		setIcon(totalGroup.createSpan({ cls: "task-time-tracker-totals-duration-icon" }), "timer");
		totalGroup.createSpan({ text: formatDurationCompact(totalMs), cls: "task-time-tracker-totals-duration" });
	}

	// Orden cronologico ascendente (mas antigua arriba, mas reciente abajo)
	// — mismo criterio canonico que el resto de la app (panel del Historial,
	// CSV de exportacion). No se reordena tras cada render(): solo la
	// apertura inicial hace scroll al final (ver onOpen()).
	private renderSessions(): void {
		const container = this.sessionsEl;
		if (!container) return;
		container.empty();

		const entries = this.getEntries();
		if (entries.length === 0) {
			container.createEl("p", { text: t("log.emptyDay"), cls: "task-time-tracker-log-empty-day" });
			return;
		}

		const detail = container.createDiv({ cls: "task-time-tracker-log-card-detail" });
		for (const entry of [...entries].sort((a, b) => a.start - b.start)) {
			this.renderSessionRow(detail, entry);
		}
	}

	private renderSessionRow(container: Element, entry: TimeEntry): void {
		if (this.editingEntryId === entry.id) {
			this.renderEditForm(container, entry);
			return;
		}

		const row = container.createDiv({ cls: "task-time-tracker-log-session-row" });
		renderSessionInfo(row, entry);

		// Solo sesiones cerradas son editables: la activa (si la tarea
		// tuviera una en curso) nunca se edita desde aqui.
		if (entry.end !== null) {
			row.addClass("task-time-tracker-log-session-row-editable");
			row.addEventListener("click", () => {
				this.editingEntryId = entry.id;
				this.draft = {
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
				this.renderSessions();
			});
		}
	}

	// Campo de texto con icono + etiqueta encima (fecha u hora), parte de
	// una de las dos parejas (inicio/fin) del formulario de edicion. Sin
	// selector nativo del sistema: type="text" siempre.
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
		const draft = this.draft;
		if (!draft) return;

		const form = container.createDiv({ cls: "task-time-tracker-log-edit-form" });

		if (draft.confirmingDelete) {
			// Los datos de la sesion (originales, no lo que se haya
			// tecleado sin guardar) siguen visibles mientras se confirma.
			renderSessionInfo(form, entry);
			form.createEl("p", {
				text: t("log.deleteSessionConfirm"),
				cls: "task-time-tracker-log-edit-error",
			});
			const actions = form.createDiv({ cls: "task-time-tracker-log-edit-actions" });
			actions.createEl("button", { text: t("log.deleteSessionYes"), cls: "mod-warning" }).addEventListener("click", () => {
				void this.actions.deleteEntry(entry.id).then(() => {
					// No local splice: renderSessions() re-reads the task's
					// history, which no longer includes this session.
					this.editingEntryId = null;
					this.draft = null;
					this.renderSessions();
					this.renderSummary();
					this.onChange();
				});
			});
			actions.createEl("button", { text: t("log.cancel") }).addEventListener("click", () => {
				draft.confirmingDelete = false;
				this.renderSessions();
			});
			return;
		}

		// Parejas etiquetadas con icono (fecha inicio/hora inicio, fecha
		// fin/hora fin), todas como campos de texto libres, sin selector
		// nativo del sistema ni siquiera para las fechas. El grid se apila
		// verticalmente en pantallas estrechas y pasa a una sola fila si
		// hay ancho suficiente (ver .task-time-tracker-log-edit-grid).
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

		// El estado "invalido" se guarda en el draft ({campo}Evaluated), no
		// solo como clase CSS: un refresh externo reconstruye este
		// formulario entero, y sin esto la marca visual se perderia aunque
		// el campo siguiera siendo invalido.
		startDateInput.toggleClass("is-invalid", draft.startDateEvaluated && parseDateInput(draft.startDate) === null);
		startInput.toggleClass("is-invalid", draft.startTimeEvaluated && parseTimeInput(draft.startTime) === null);
		endDateInput.toggleClass("is-invalid", draft.endDateEvaluated && parseDateInput(draft.endDate) === null);
		endInput.toggleClass("is-invalid", draft.endTimeEvaluated && parseTimeInput(draft.endTime) === null);

		// Bloque resaltado de solo lectura: duracion calculada en vivo a
		// partir de los cuatro campos, sin la affordance de input de los 4
		// campos de arriba — la ausencia de borde/fondo tipo-input es lo
		// que comunica "esto no se edita directamente".
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
		// aunque no haya nada que mostrar. Nunca muestra dos mensajes a la
		// vez — ver updateMessage() para la prioridad entre ellos.
		const messageEl = form.createEl("p", { cls: "task-time-tracker-log-edit-message" });

		const actions = form.createDiv({ cls: "task-time-tracker-log-edit-actions" });
		const saveButton = actions.createEl("button", { text: t("log.save"), cls: "mod-cta" });
		saveButton.addEventListener("click", () => {
			void this.saveDraft(entry);
		});
		actions.createEl("button", { text: t("log.cancel") }).addEventListener("click", () => {
			this.editingEntryId = null;
			this.draft = null;
			this.renderSessions();
		});

		// "Eliminar sesion": icono de papelera en la misma fila que
		// Guardar/Cancelar, empujado al extremo derecho.
		const deleteBtn = actions.createEl("button", { cls: "task-time-tracker-log-edit-delete clickable-icon" });
		setIcon(deleteBtn, "trash-2");
		deleteBtn.setAttribute("aria-label", t("log.delete"));
		deleteBtn.addEventListener("click", () => {
			draft.confirmingDelete = true;
			this.renderSessions();
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
			const startDateInvalid = draft.startDateEvaluated && parseDateInput(draft.startDate) === null;
			const endDateInvalid = draft.endDateEvaluated && parseDateInput(draft.endDate) === null;
			const startTimeInvalid = draft.startTimeEvaluated && parseTimeInput(draft.startTime) === null;
			const endTimeInvalid = draft.endTimeEvaluated && parseTimeInput(draft.endTime) === null;
			const formatInvalid = startDateInvalid || endDateInvalid || startTimeInvalid || endTimeInvalid;
			// Bloqueo real del boton, no solo un mensaje, y computado siempre
			// (no solo dentro de la rama de formato invalido): un valor con
			// formato invalido (ej. dia fuera de rango del mes) nunca debe
			// poder llegar a saveDraft() ni por accidente — ver bug critico QA
			// 0.0.29 (fecha invalida se guardaba silenciosamente como otra
			// fecha distinta, sin aviso).
			saveButton.disabled = formatInvalid;

			if (draft.error) {
				setMessage(draft.error, "error");
				return;
			}
			if (formatInvalid) {
				setMessage(t("log.errorFormat"), "error");
				return;
			}

			const resolved = resolveDraftTimestamps(draft);
			if (!resolved.ok) {
				// Formato todavia incompleto pero no marcado invalido (el
				// usuario sigue escribiendo) — sin mensaje todavia.
				setMessage("", "none");
				return;
			}
			if (resolved.end <= resolved.start) {
				setMessage(t("log.errorRange"), "error");
				return;
			}

			const { start, end } = effectiveRange(draft, entry, resolved);
			const overlapping = this.getAllEntries().some(
				(other) => other.id !== entry.id && rangesOverlap(start, end, other.start, other.end ?? Date.now()),
			);
			setMessage(overlapping ? t("log.warnOverlap") : "", overlapping ? "warning" : "none");
		};

		// Vista previa en vivo de la duracion calculada, sin reconstruir el
		// formulario entero — eso perderia el foco del input a mitad de
		// tecleo. Sin duracion valida todavia, se muestra "—".
		const updatePreview = () => {
			const resolved = resolveDraftTimestamps(draft);
			if (!resolved.ok) {
				durationPreview.setText("—");
				return;
			}
			const { start, end } = effectiveRange(draft, entry, resolved);
			durationPreview.setText(end > start ? formatDuration(end - start) : "—");
		};

		// El formato NO se evalua en cada tecla: solo al perder el foco
		// (blur) o al llegar a la longitud completa del campo (10
		// caracteres "YYYY-MM-DD", 8 "HH:MM:SS"). Sin selector nativo ni
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
	private async saveDraft(entry: TimeEntry): Promise<void> {
		const draft = this.draft;
		if (!draft) return;

		const resolved = resolveDraftTimestamps(draft);
		if (!resolved.ok) {
			draft.error = resolved.error;
			this.renderSessions();
			return;
		}
		if (resolved.end <= resolved.start) {
			draft.error = t("log.errorRange");
			this.renderSessions();
			return;
		}

		const result = await this.actions.updateEntryTimes(entry.id, resolved.start, resolved.end);
		if (!result.ok) {
			draft.error = result.error === "invalid-range" ? t("log.errorRange") : t("log.errorGone");
			this.renderSessions();
			return;
		}

		this.editingEntryId = null;
		this.draft = null;
		this.renderSessions();
		this.renderSummary();
		this.onChange();
	}
}
