// ui/EditTaskModal.ts
// "Editar tarea desde el Historial" — the only way to manage a task
// from the Historial: reassigning Project/Client (live link by tt-id,
// see core/ProjectManager.ts) and editing/deleting individual sessions.
// The task name is purely informational (no navigation to the note —
// that only lives in the card's file-search icon, see TimeLogView.ts)
// and deleting the whole task only lives in the card's kebab menu,
// never here.

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
	// There's no documented public hook (see obsidian.d.ts#Modal) to
	// disable closing on an outside click. The only public-API-only way:
	// detect a mousedown outside modalEl (containerEl/modalEl are both
	// public) and, for a very brief window afterward, block any close()
	// in the override below. Neither Esc nor the "Close" button ever go
	// through a mousedown outside the modal, so they never trigger this
	// block — no need to touch their handling, which already works.
	private outsideMousedownGuardUntil = 0;

	constructor(
		app: App,
		private taskId: string,
		private label: string,
		// `label` always arrives as the real taskText (the same snapshot
		// the Historial card uses, see TimeLogView.ts#renderTaskCard),
		// never the generic "Task not found". This flag only controls the
		// extra "Note not found" warning under the title — it doesn't
		// affect tt-id, Project, or Sessions, which already work without
		// depending on the note.
		private isMissing: boolean,
		// The full history of THIS task and the project list, both as
		// readers: the in-memory state is replaced wholesale after every
		// write (read-before-write, see core/StateStore.ts), so capturing
		// the array would leave orphan objects — and reading on demand also
		// makes a change delivered by sync visible on the next render.
		private getEntries: () => TimeEntry[],
		// All of the plugin's entries (not just this task's): the overlap
		// warning compares against any other session, same as the earlier
		// inline editing did.
		private getAllEntries: () => TimeEntry[],
		private getProjects: () => Project[],
		currentProject: Project | null,
		private actions: EditTaskModalActions,
		// Refreshes the Historial panel behind the modal after every
		// mutation (reassigning a project, editing or deleting a session).
		private onChange: () => void,
	) {
		super(app);
		this.currentProjectId = currentProject?.id ?? "";
	}

	// The only real closing point allowed, aside from the guard on
	// close() below. See the comment next to outsideMousedownGuardUntil
	// for why this is resolved this way (public API only).
	close(): void {
		if (Date.now() < this.outsideMousedownGuardUntil) return;
		super.close();
	}

	onOpen(): void {
		const { contentEl } = this;
		// On modalEl (not contentEl): modal-title lives in modal-header, a
		// sibling of modal-content, so this modal's CSS selector (see
		// .task-time-tracker-edit-modal .modal-title in styles.css) needs
		// a common ancestor of both to reach the title.
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

		// Uses the Modal's native title (this.titleEl, public via
		// setTitle()) instead of a plain h3 inside contentEl. Obsidian
		// already positions titleEl on the same row as its close (X)
		// button inside modal-header — fixes the misalignment at the
		// root, no need to hand-patch a margin-top.
		this.setTitle(this.label);

		// Note deleted: italic warning under the title, unlike the
		// Historial card's treatment (there the name goes italic; here
		// the title stays normal and this warning is what goes italic).
		// Doesn't affect tt-id/Project/Sessions.
		if (this.isMissing) {
			contentEl.createDiv({ text: t("log.noteNotFound"), cls: "task-time-tracker-edit-modal-note-missing" });
		}

		// Secondary metadata (always visible, not subject to the
		// Normal/Reduced/Hidden levels of the tt-id rendered in the note
		// via Dataview — that's a separate setting on the note, see
		// SettingsTab.ts#taskIdFormat): a clean id (no brackets or
		// "tt-id::", same as the export CSV's column, see CsvAdapter.ts)
		// plus a copy button. Same dimmed style the panel's subtitle
		// already uses (task-time-tracker-log-subtitle).
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

		// Button + popover (shared "Project picker list" component, see
		// ProjectPickerList.ts) instead of the previous native <select>:
		// label and button together, left-aligned.
		const projectRow = contentEl.createDiv({ cls: "task-time-tracker-edit-modal-project-row" });
		projectRow.createSpan({ text: t("log.editModalProjectLabel"), cls: "task-time-tracker-edit-modal-project-label" });
		const projectBtn = projectRow.createEl("button", {
			cls: "task-time-tracker-log-filter-btn task-time-tracker-edit-modal-project-btn",
		});
		setIcon(projectBtn.createSpan(), "briefcase");
		const projectBtnLabel = projectBtn.createSpan({ cls: "task-time-tracker-log-filter-btn-label" });
		this.updateProjectBtnLabel(projectBtnLabel);
		projectBtn.addEventListener("click", () => {
			// Permanent guard while the popover is open (not just the
			// 300ms of the automatic detector above): the popover lives
			// outside modalEl (appended to document.body so it can be
			// positioned with position: fixed), so searching or clicking a
			// row inside it would look like a click "outside the modal"
			// and close it — same problem as the native <select> this
			// button replaces (see the comment next to
			// outsideMousedownGuardUntil above).
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

		// Reserved space (one line, see styles.css min-height) from the
		// first render, empty by default — keeps the "Project updated"
		// warning from shifting the rest of the modal when it appears or
		// disappears.
		this.projectFeedbackEl = contentEl.createDiv({ cls: "task-time-tracker-edit-modal-project-feedback" });

		// "Sessions" heading and summary (# sessions + total) share a row:
		// title on the left, summary on the right. The summary uses the
		// same format/classes the panel's card already uses — deliberately
		// different from the total on the card that opened this modal
		// (that one is scoped to the visible day/week); here it's the
		// task's entire history, consistent with the rest of the modal.
		const sessionsHeader = contentEl.createDiv({ cls: "task-time-tracker-edit-modal-sessions-header" });
		sessionsHeader.createEl("h4", { text: t("log.editModalSessionsHeading") });
		this.summaryEl = sessionsHeader.createDiv({ cls: "task-time-tracker-log-meta task-time-tracker-edit-modal-summary" });
		this.renderSummary();

		this.sessionsEl = contentEl.createDiv({ cls: "task-time-tracker-edit-modal-sessions" });
		this.renderSessions();
		// On open, the most recent session (last in ascending
		// chronological order, see renderSessions()) is visible without
		// manual scrolling — only on the initial open, not on every
		// re-render after editing.
		this.sessionsEl.scrollTop = this.sessionsEl.scrollHeight;

		new Setting(contentEl).addButton((button) =>
			button.setButtonText(t("log.close")).onClick(() => this.close()),
		);
	}

	onClose(): void {
		if (this.feedbackTimeoutId !== null) window.clearTimeout(this.feedbackTimeoutId);
		this.contentEl.empty();
	}

	// Inline feedback (no global Notice, no footer): writes the message
	// into the already-reserved space and fades it after ~3s. Restarts
	// the timer if reassigned again before the previous one finishes, so
	// two reassignments in a row don't clobber each other mid-fade.
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
			// Clears the text only after the fade (see transition in
			// styles.css) to avoid leaving an invisible-but-present text
			// node (accessibility) longer than necessary.
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

	// Ascending chronological order (oldest on top, most recent at the
	// bottom) — same canonical criterion as the rest of the app (the
	// Historial panel, the export CSV). Not reordered on every render():
	// only the initial open scrolls to the end (see onOpen()).
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

		// Only closed sessions are editable: the active one (if the task
		// had one running) is never edited from here.
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

	// Text field with an icon + label above (date or time), part of one
	// of the edit form's two pairs (start/end). No native system picker:
	// always type="text".
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
			// The session's data (original, not whatever was typed but not
			// saved) stays visible while confirming.
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

		// Icon-labeled pairs (start date/start time, end date/end time),
		// all as free text fields, no native system picker even for
		// dates. The grid stacks vertically on narrow screens and moves
		// to a single row if there's enough width (see
		// .task-time-tracker-log-edit-grid).
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

		// The "invalid" state is saved in the draft ({field}Evaluated),
		// not only as a CSS class: an external refresh rebuilds this
		// whole form, and without this the visual marker would be lost
		// even though the field was still invalid.
		startDateInput.toggleClass("is-invalid", draft.startDateEvaluated && parseDateInput(draft.startDate) === null);
		startInput.toggleClass("is-invalid", draft.startTimeEvaluated && parseTimeInput(draft.startTime) === null);
		endDateInput.toggleClass("is-invalid", draft.endDateEvaluated && parseDateInput(draft.endDate) === null);
		endInput.toggleClass("is-invalid", draft.endTimeEvaluated && parseTimeInput(draft.endTime) === null);

		// Highlighted read-only block: duration computed live from the
		// four fields, without the input affordance of the four fields
		// above — the absence of an input-like border/background is what
		// communicates "this isn't edited directly".
		const durationBlock = form.createDiv({ cls: "task-time-tracker-log-edit-duration" });
		const durationLabelGroup = durationBlock.createDiv({ cls: "task-time-tracker-log-edit-duration-label-group" });
		setIcon(durationLabelGroup.createSpan(), "timer");
		durationLabelGroup.createSpan({
			text: t("log.editDurationLabel"),
			cls: "task-time-tracker-log-edit-duration-label",
		});
		const durationPreview = durationBlock.createSpan({ cls: "task-time-tracker-log-edit-duration-value" });

		// Single, fixed warning block, right below the duration block:
		// always in the same position, with height reserved even when
		// there's nothing to show. Never shows two messages at once — see
		// updateMessage() for the priority between them.
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

		// "Delete session": trash icon on the same row as Save/Cancel,
		// pushed to the far right.
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

		// Priority, never two at once: 1) backend save error (session
		// deleted while editing) 2) format error — only if some field has
		// already been evaluated (blur or full length, see
		// bindDraftField; never while still typing) 3) end <= start (once
		// the format is valid) 4) overlap warning (only with valid format
		// and end > start) 5) nothing.
		const updateMessage = () => {
			const startDateInvalid = draft.startDateEvaluated && parseDateInput(draft.startDate) === null;
			const endDateInvalid = draft.endDateEvaluated && parseDateInput(draft.endDate) === null;
			const startTimeInvalid = draft.startTimeEvaluated && parseTimeInput(draft.startTime) === null;
			const endTimeInvalid = draft.endTimeEvaluated && parseTimeInput(draft.endTime) === null;
			const formatInvalid = startDateInvalid || endDateInvalid || startTimeInvalid || endTimeInvalid;
			// Real button blocking, not just a message, and always
			// computed (not only inside the invalid-format branch): a
			// value with an invalid format (e.g. a day out of the month's
			// range) must never be able to reach saveDraft() even by
			// accident (see docs/DECISIONS.md).
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
				// Format still incomplete but not marked invalid (the user
				// is still typing) — no message yet.
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

		// Live preview of the computed duration, without rebuilding the
		// whole form — that would lose the input's focus mid-typing. With
		// no valid duration yet, "—" is shown.
		const updatePreview = () => {
			const resolved = resolveDraftTimestamps(draft);
			if (!resolved.ok) {
				durationPreview.setText("—");
				return;
			}
			const { start, end } = effectiveRange(draft, entry, resolved);
			durationPreview.setText(end > start ? formatDuration(end - start) : "—");
		};

		// The format is NOT evaluated on every keystroke: only on losing
		// focus (blur) or reaching the field's full length (10 characters
		// for "YYYY-MM-DD", 8 for "HH:MM:SS"). No native picker or
		// up/down arrows: edited by hand only.
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

	// End must be after start, with the midnight-crossing logic already
	// applied (see resolveDraftTimestamps). Overlap with another session
	// is already warned about live while editing (see updateMessage());
	// it isn't checked again here, it never blocks saving.
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
