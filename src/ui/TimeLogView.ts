// ui/TimeLogView.ts
// Each entry is resolved by its tt-id::; if the line no longer exists in
// any note, it's shown as "Tarea no encontrada" without discarding the
// history.
// Since "Editar tarea desde el Historial", the card is read-only with
// three independent clickable zones (note icon, kebab menu, session row
// that expands/collapses a read-only detail); all management
// (reassigning Project/Client, editing sessions, deleting a session)
// lives in EditTaskModal.ts. Deleting the whole task only fires from the
// kebab.

import { ItemView, Menu, MarkdownView, Notice, Platform, TFile, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import { formatDuration, formatDurationCompact } from "../core/TrackingEngine";
import { parseCheckboxLine, ResolvedTask, TaskIdentifier } from "../core/TaskIdentifier";
import { t } from "../i18n";
import { DeleteTaskResult, EntryUpdateResult, Project, TimeEntry } from "../types";
import { openDatePickerPopover, reanchorDatePickerPopover } from "./DatePickerPopover";
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
	// "Retomar tracking de una tarea ya registrada" — starts a NEW
	// session for a tt-id that already has history, without reading or
	// writing the source note (doesn't matter if it was edited or
	// deleted since the last session): the new TimeEntry's taskText/
	// filePath are taken from that task's most recently saved session,
	// same as handleInlineStart() takes them from the editor when the
	// task is tracked from the note. Never reopens/continues the
	// previous session. A no-op if that task already has the active
	// session (shouldn't happen: the card's button already shows stop in
	// that case).
	resumeTracking(taskId: string): Promise<void>;
	// A task's entire history (all its sessions, not scoped to the
	// visible day/week) — feeds the Edit modal, which manages the whole
	// history and not just what the card currently shows.
	getEntriesForTask(taskId: string): TimeEntry[];
	getProjects(): Project[];
	getProjectForTask(taskId: string): Project | null;
	assignProject(taskId: string, projectId: string | null): Promise<void>;
	// Same bus the badge next to the checkbox already uses (see
	// InlineTaskControlExtension.ts): notifies every second while there's
	// an active session, so that task's card (if it's in the visible
	// date range) updates its live counter without needing a full
	// render() of the panel.
	bus: InlineTrackingBus;
}

function addDays(dateAtMidnightMs: number, days: number): number {
	const d = new Date(dateAtMidnightMs);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0).getTime();
}

// Historial date navigation (day/week). All filtering uses entry.start's
// LOCAL calendar day (never entry.end): a session counts on the day it
// started, even if it crosses midnight.
function startOfDay(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

// Monday-to-Sunday week (ISO convention), from any date within it.
function startOfWeek(ms: number): number {
	const dayStart = startOfDay(ms);
	const weekday = new Date(dayStart).getDay(); // 0 = Sunday ... 6 = Saturday
	const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
	return addDays(dayStart, diffToMonday);
}

function isSameLocalDay(ms: number, dayStartMs: number): boolean {
	return startOfDay(ms) === dayStartMs;
}

// Short date format for the Resultados empty state ("17 y 23 ago"): day
// + abbreviated month, resolved via Intl to follow Obsidian's language.
function formatShortDate(ms: number): string {
	return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// Range title in the Resultados header (see renderDateNav): same "-"
// dash as the rest of the panel, but more compact than the date-picker
// or the Resultados empty state (which always show the full month on
// both sides, see renderResultsEmptyState) — here month/year is omitted
// on the left end when it matches the right one, since it's a
// single-line title meant to fit next to "Volver" and calendar+Filter
// on the same row.
function formatResultsRangeTitle(startMs: number, endMs: number): string {
	const start = new Date(startMs);
	const end = new Date(endMs);
	const sameYear = start.getFullYear() === end.getFullYear();
	const sameMonth = sameYear && start.getMonth() === end.getMonth();

	if (sameMonth) {
		return `${start.getDate()} - ${formatShortDate(endMs)}`;
	}
	if (sameYear) {
		return `${formatShortDate(startMs)} - ${formatShortDate(endMs)}`;
	}
	const withYear = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
	return `${withYear(startMs)} - ${withYear(endMs)}`;
}

// "· N dias" metadata on the Resultados range box: calendar days in the
// range, both ends included — not just days with activity (that's
// already covered by the "N tareas · M dias con actividad" subtitle, see
// renderSubtitle). Math.round (not exact division) for the same reason
// as renderResultsSection#totalDays: a range can cross a daylight saving
// change, where the real calendar day doesn't measure exactly 86400000ms.
function formatResultsRangeDays(startMs: number, endMs: number): string {
	const days = Math.round((endMs - startMs) / 86400000) + 1;
	const word = days === 1 ? t("log.day.singular") : t("log.day.plural");
	return `${days} ${word}`;
}

// Range results view — maximum number of calendar days resolved/
// rendered per page (see renderResultsSection()): a larger range has no
// selection limit, but the list is cut here and a "Cargar mas" button
// adds the next page, to avoid trying to resolve hundreds/thousands of
// days (the vast majority empty) of a very wide range (e.g. a year) all
// at once.
const RESULTS_PAGE_DAYS = 180;

type LogViewMode = "day" | "week" | "results";

export class TimeLogView extends ItemView {
	// expandedTaskIds keys are "<day>|<taskId>" (not just taskId): in
	// week view the same task can have sessions on several days, each
	// with its own card, and they must be able to expand independently.
	private expandedTaskIds = new Set<string>();
	// expandKey of the card that was just expanded in this very gesture
	// (not one already expanded from before): triggers the automatic
	// scroll to the end of the detail (most recent session) once, not on
	// every subsequent render() while the card stays expanded.
	private pendingScrollKey: string | null = null;
	// Deleting a whole task (its entire history by tt-id): pending
	// confirmation, if any. Stored by taskId, not by card/day: if the
	// same task appears in several cards (week view), the confirmation
	// is reflected in all of them at once, since the action affects the
	// entire history, not a single card.
	private taskDeleteConfirmId: string | null = null;
	// Every time the panel opens (a new view instance, see registerView
	// in main.ts) it always starts on "today" in day view; there's no
	// memory of the last date/mode seen in a previous open.
	private viewMode: LogViewMode = "day";
	private anchorDate: number = startOfDay(Date.now());
	// Header's project filter (see renderProjectFilter()): kept in the
	// component's memory, never persisted to data.json — every time the
	// panel opens it starts with no filter, same as it always starts on
	// "today"/day view (see the viewMode comment above).
	private projectFilterId: string | null = null;
	// "No project" filter (see renderProjectFilter()): separate from
	// projectFilterId because null in projectFilterId already means "no
	// filter" — this filter needs a third state (specific project / no
	// filter / no project) that projectFilterId alone can't represent.
	// Mutually exclusive with projectFilterId: never both active at once.
	private projectFilterNoProject = false;
	// Range results view (see renderResultsSection()): only make sense
	// when viewMode === "results" — a range of two different days
	// applied in the date-picker (see renderDateNav()) sets them;
	// "Volver"/"Limpiar" doesn't clear them, it only changes viewMode to
	// "day" (they're overwritten by the next applied range, no need to
	// clear them first).
	private resultsRangeStart: number | null = null;
	private resultsRangeEnd: number | null = null;
	// How many pages of RESULTS_PAGE_DAYS days have already been
	// "loaded" (the "Cargar mas" button) for the current range — resets
	// to 1 every time a new range is applied from the date-picker.
	private resultsLoadedPages = 1;
	// Elements with a live counter for the active task (if it's in the
	// visible date range after the last render()): recalculated every
	// second via the bus, without rebuilding the whole panel. There can
	// be more than one at a time — the header's stop button and, if the
	// card is expanded, its ongoing session's row inside the detail.
	// Empty if the actively tracked task doesn't appear in any currently
	// rendered element.
	// kind "duration": formatDuration (HH:MM:SS), redrawn every tick.
	// kind "total": formatDurationCompact (Xh Ym) of the card's sum —
	// same per-second tick, but only touches the DOM when the shown
	// minute changes (lastMinute), since the compact format has no
	// seconds and redrawing every second would be wasted work.
	private activeCardTicks: Array<
		| { kind: "duration"; el: HTMLElement; completedMs: number; start: number }
		| { kind: "total"; el: HTMLElement; completedMs: number; start: number; lastMinute: number }
	> = [];
	private busUnsubscribe: (() => void) | null = null;
	// render() is async (resolveTaskIds reads the vault) and can fire
	// more than once for the same user action (e.g. saving an edit:
	// saveEditDraft() calls render() explicitly, and main.ts already
	// fires refreshLogViews() -> render() from inside
	// updateEntryTimes()). Without this guard, an older call resuming
	// after its own await could keep adding cards to a container a more
	// recent call already emptied and rebuilt, duplicating content. Each
	// render() keeps its own turn number when it starts; if, on
	// resuming after an await, that number no longer matches the latest
	// one, it aborts without touching the DOM.
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
			// Under a minute, formatDurationCompact already returns "Ns"
			// (same criterion as the rest of the panel for short
			// sessions): it redraws every tick, same as the "duration"
			// counter next to it, so the total doesn't look stuck during
			// an active session's first minute. Past a minute (format
			// "Xh Ym"/"Ym"), it only redraws again if the shown minute
			// changes.
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

	// Groups by tt-id preserving the order of appearance in `entries`
	// (already sorted by ascending start date from renderDaySection()),
	// so each task ends up ordered by that day's oldest session's date.
	private groupByTaskId(entries: TimeEntry[]): Map<string, TimeEntry[]> {
		const grouped = new Map<string, TimeEntry[]>();
		for (const entry of entries) {
			const bucket = grouped.get(entry.taskId);
			if (bucket) bucket.push(entry);
			else grouped.set(entry.taskId, [entry]);
		}
		return grouped;
	}

	// dayKey identifies the (local calendar) day these cards belong to
	// (see renderDaySection()); only used to give each card its own
	// expansion key, it doesn't filter anything here (entries already
	// arrive scoped to the visible date range).
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

	// Read-only card with three independent clickable zones (see
	// "Editar tarea desde el Historial"): open-note icon, kebab menu
	// (Edit/Delete), and the session row that expands/collapses a
	// likewise read-only detail. Nothing else on the card reacts to a
	// click — not the whole header, not the blank area.
	// The total (totalMs) is taskEntries' as-is: scoped to the visible
	// date range (day or week), deliberately different from the full
	// historical total the badge next to the checkbox shows, and from
	// the full history the Edit modal manages.
	private renderTaskCard(
		list: Element,
		taskId: string,
		taskEntries: TimeEntry[],
		resolutions: Map<string, ResolvedTask | null>,
		dayKey: number,
	): void {
		const label = this.taskLabel(taskId, resolutions);

		// Whole-task delete confirmation: steps out of the card's normal
		// flow (no expandable header or detail), same as confirmingDelete
		// does for an individual session — see renderTaskDeleteConfirm().
		if (this.taskDeleteConfirmId === taskId) {
			const card = list.createDiv({ cls: "task-time-tracker-log-row" });
			this.renderTaskDeleteConfirm(card, taskId, label);
			return;
		}

		const expandKey = `${dayKey}|${taskId}`;
		const totalMs = taskEntries.reduce((sum, entry) => sum + ((entry.end ?? Date.now()) - entry.start), 0);
		const isMissing = resolutions.get(taskId) == null;
		const expanded = this.expandedTaskIds.has(expandKey);
		// The active session, if it's one of THIS card's entries (already
		// scoped to the visible date range by renderDaySection()): since
		// there's only one active timer across the whole plugin, at most
		// one card in the whole view can satisfy this. If the active task
		// has no session in the visible range, activeEntry is null here
		// and the card behaves exactly like any other.
		const activeEntry = taskEntries.find((entry) => entry.end === null) ?? null;
		const project = this.actions.getProjectForTask(taskId);

		const card = list.createDiv({ cls: "task-time-tracker-log-row" });
		card.toggleClass("is-tracking-active", activeEntry !== null);

		const header = card.createDiv({ cls: "task-time-tracker-log-card-header" });
		// The whole header (icon/title/meta + project row) expands or
		// collapses on click (see docs/DECISIONS.md); hover on desktop
		// highlights it as a purely visual addition on top of that same
		// gesture. The note icon and the kebab remain their own
		// independent zones (evt.stopPropagation already in both).
		// `detail` (the expanded content) lives outside `header`, in
		// `card` — clicking inside an already-expanded session doesn't
		// collapse the card again.
		header.addEventListener("click", () => {
			if (expanded) {
				this.expandedTaskIds.delete(expandKey);
			} else {
				this.expandedTaskIds.add(expandKey);
				this.pendingScrollKey = expandKey;
			}
			void this.render();
		});

		// The outer row has 3 direct children, not 5. icon+title+project/
		// client live together inside `infoBlock` (flex:1 1 auto,
		// column) — ONLY THIS WAY can the right column and the kebab,
		// siblings of `infoBlock` (not of `titleLine`), align against the
		// whole block (title + meta), not just against the first row. No
		// chevron (see docs/DECISIONS.md): the whole row already
		// expands/collapses on click (see header.addEventListener
		// above).
		const outerRow = header.createDiv({ cls: "task-time-tracker-log-card-title-row" });
		const infoBlock = outerRow.createDiv({ cls: "task-time-tracker-log-card-info" });

		// Title row: icon + name, nested inside infoBlock (previously
		// lived loose as direct children of the outer row).
		const titleLine = infoBlock.createDiv({ cls: "task-time-tracker-log-card-title-line" });
		if (!isMissing) {
			// Zone 1 — the only navigation point to the note; its own
			// hit-area and children, doesn't interfere with the title or
			// the kebab.
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
			// "Not found" task: same class as the normal note icon (same
			// size and hit-area) — only the icon and the click action
			// change, which can no longer open a note that doesn't exist.
			const missingBtn = titleLine.createEl("button", {
				cls: "task-time-tracker-log-card-note task-time-tracker-log-card-note-missing task-time-tracker-icon-btn clickable-icon",
			});
			setIcon(missingBtn, "file-x");
			missingBtn.setAttribute("aria-label", t("log.noteNotFoundAriaLabel"));
			missingBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				new Notice(t("notice.noteNotFound"));
			});
		}

		// Title: no hover or click action of its own (navigation only
		// lives in the icon above) — only a tooltip with the full text on
		// desktop if it's truncated.
		// Note deleted: the title no longer shows the generic "Task not
		// found" (that text is still used by taskLabel(), used only by
		// the delete confirmation); instead it uses taskText, the same
		// immutable snapshot that already resolves this same case in the
		// Dashboard (see resolveTaskLabels() in DashboardView.ts), in
		// italics and without touching the title's color.
		const mostRecent = isMissing
			? taskEntries.reduce((latest, entry) => (entry.start > latest.start ? entry : latest))
			: null;
		const titleText = mostRecent ? mostRecent.taskText : label;
		const title = titleLine.createDiv({ text: titleText, cls: "task-time-tracker-log-task" });
		if (isMissing) {
			title.addClass("task-time-tracker-log-task-title-missing-note");
		}

		if (isMissing) {
			infoBlock.createDiv({ text: t("log.noteNotFound"), cls: "task-time-tracker-log-task-snapshot" });
		}

		// Row 2 — Project/Client: only if a project is assigned (live
		// link by tt-id, see ProjectManager#getProjectForTask). Inside
		// infoBlock (no longer a loose sibling of the title row),
		// indented with padding-left under the title's TEXT, not under
		// the icon (see renderProjectRow()). No hover or click action of
		// its own; reassigning still lives inside the Edit modal.
		if (project) {
			this.renderProjectRow(infoBlock, project);
		}

		// Time Tracker Tab v2 redesign — ghost play / filled stop button, in
		// a fixed horizontal slot between the title and the time/sessions
		// column (no longer after the kebab): the slot never moves, whether
		// idle or active. The slot collapses to width:0 at rest (see
		// .task-time-tracker-log-card-control-slot in styles.css) and only
		// reveals the ghost play on hover/focus of the row (desktop) or
		// always on touch — CSS-only, no JS needed for that part. The
		// active row's stop lives in the same slot but never collapses,
		// since there is at most one active row at a time. No duration
		// counter and no pulsing bullet inside either state — the total in
		// the next column already carries both (see the bullet pushed into
		// totalGroup above).
		//
		// A span, not a <button> (style QA fix — mirrors the inline play/
		// stop control next to the task in the note, see
		// InlineTaskControlView in InlineTaskControl.ts): a real <button>
		// carries Obsidian's/the browser's own default appearance (most
		// visibly a hover box-shadow) that this tightly-fitted 28px circle
		// has no room for without clipping it. A span has none of that
		// baggage, but doesn't get keyboard behavior for free either, so
		// role="button" + tabIndex + an explicit Enter/Space handler
		// replace what a native button would have given us automatically.
		const controlSlot = outerRow.createDiv({ cls: "task-time-tracker-log-card-control-slot" });
		controlSlot.toggleClass("is-active", activeEntry !== null);
		const controlBtn = controlSlot.createSpan({ cls: "task-time-tracker-log-card-control" });
		controlBtn.toggleClass("is-active", activeEntry !== null);
		controlBtn.setAttribute("role", "button");
		controlBtn.tabIndex = 0;
		const controlLabel = activeEntry ? t("log.stopTrackingAriaLabel") : t("log.resumeTrackingAriaLabel");
		controlBtn.setAttribute("aria-label", controlLabel);
		setTooltip(controlBtn, controlLabel);
		setIcon(controlBtn, activeEntry ? "square" : "play");
		const triggerControl = (evt: Event) => {
			evt.stopPropagation();
			if (activeEntry) {
				void this.actions.stopTracking();
			} else {
				void this.actions.resumeTracking(taskId);
			}
		};
		controlBtn.addEventListener("click", triggerControl);
		controlBtn.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter" && evt.key !== " ") return;
			evt.preventDefault();
			triggerControl(evt);
		});

		// Right column: aggregate duration on top, session count below,
		// stacked in its own column — kebab next, always in that same
		// outer row. tt-id is removed from this view (see
		// docs/DECISIONS.md): it doesn't help the end user and had no
		// slot in the right-column design; it still exists as an
		// internal concept (ProjectManager, see TaskIdentifier), it just
		// stops being painted here.
		const rightCol = outerRow.createDiv({ cls: "task-time-tracker-log-card-right-col" });
		// Aggregate total (several sessions summed): compact format, not
		// HH:MM:SS — see formatDurationCompact(). Pulsing bullet only if
		// tracking is active (see below).
		const totalGroup = rightCol.createSpan({ cls: "task-time-tracker-totals-duration-group" });
		// The pulsing bullet in accent color (same class/animation as the
		// inline badge next to the checkbox, see
		// .task-time-tracker-inline-dot) replaces the old stopwatch icon
		// here: it signals the number next to it updates live without
		// suggesting an action on itself (unlike an icon inside a
		// button). It lives next to the TOTAL, never inside the
		// play/stop button — see the control above, between the title
		// and this column.
		if (activeEntry) {
			totalGroup.createSpan({ cls: "task-time-tracker-inline-dot task-time-tracker-log-card-total-dot" });
		}
		const totalDuration = totalGroup.createSpan({
			text: formatDurationCompact(totalMs),
			cls: "task-time-tracker-totals-duration",
		});
		rightCol.createSpan({
			text: `${taskEntries.length} ${taskEntries.length === 1 ? t("log.session.singular") : t("log.session.plural")}`,
			cls: "task-time-tracker-log-session-count",
		});

		if (activeEntry) {
			// Header total ("N sessions · Xh Ym"): completedMs is the sum
			// of this card's ALREADY closed sessions; the per-second tick
			// (via the bus) adds the elapsed time since activeEntry.start
			// on top. Compact format, without redrawing every second (see
			// tickActiveCard) — previously it only updated on an external
			// refresh of the panel.
			const completedMs = taskEntries
				.filter((entry) => entry.id !== activeEntry.id)
				.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
			this.activeCardTicks.push({
				kind: "total",
				el: totalDuration,
				completedMs,
				start: activeEntry.start,
				lastMinute: Math.floor(totalMs / 60000),
			});
		}

		// Zone 2 — kebab menu: always visible, doesn't depend on
		// expanding the card or row hover. Last child of the outer row —
		// fixed at the end both at rest and active (see the play/stop
		// control above, between the title and the totals column).
		const menuBtn = outerRow.createEl("button", {
			cls: "task-time-tracker-log-card-menu task-time-tracker-icon-btn clickable-icon",
		});
		setIcon(menuBtn, "more-vertical");
		menuBtn.setAttribute("aria-label", t("log.taskMenuAriaLabel"));
		setTooltip(menuBtn, t("log.taskMenuAriaLabel"));
		menuBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.openTaskMenu(menuBtn, taskId, titleText, isMissing);
		});

		// Measure AFTER titleLine and the rest of the outer row's
		// siblings (project/client, right column, kebab, stop if any)
		// are all inserted — see the detailed comment on this same bug in
		// renderProjectRow() below, where it was found: measuring a span
		// before its siblings exist gives a more generous clientWidth
		// than it'll have once they occupy their space, and the helper
		// decides (with data that isn't final yet) that no tooltip is
		// needed.
		this.applyTruncationTooltip(title, label);

		if (expanded) {
			const detail = card.createDiv({ cls: "task-time-tracker-log-card-detail" });
			// Ascending chronological order (oldest on top, most recent
			// at the bottom) — taskEntries already comes in that order
			// (see groupByTaskId).
			for (const entry of taskEntries) {
				const row = detail.createDiv({ cls: "task-time-tracker-log-session-row" });
				renderSessionInfo(row, entry, (el, completedMs, start) =>
					this.activeCardTicks.push({ kind: "duration", el, completedMs, start }),
				);
			}
			// On expanding (not on re-rendering an already-expanded card
			// for another reason), leaves the most recent session visible
			// without manual scrolling. setTimeout(0): waits for the
			// browser to finish this render's layout before
			// measuring/scrolling.
			if (this.pendingScrollKey === expandKey) {
				this.pendingScrollKey = null;
				window.setTimeout(() => detail.scrollIntoView({ block: "end" }), 0);
			}
		}
	}

	// Briefcase icon (project) + person icon (client, if any). Indented
	// with padding-left under the title's TEXT (see styles.css) — but
	// ONLY on the normal card, whose title has a note icon in front.
	// indented=false disables that padding for the delete confirmation
	// (see below), whose title carries no icon in front: with the
	// padding applied there, the row ended up indented with no reason
	// relative to the title. No hover, no click action — reassigning
	// lives inside the Edit modal (Zone 2, kebab -> Edit).
	// project null: only happens when renderTaskDeleteConfirm() calls it
	// (see below) — unlike the normal card, which omits the whole row if
	// no project is assigned, the delete confirmation shows it
	// explicitly ("No project") since it's the step right before an
	// irreversible action, where explicit is preferred over implicit.
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

		// Client did show a tooltip, Project didn't, with the same
		// helper: Project was measured (right here) before Client's span
		// (its sibling in the same flex row, see
		// .task-time-tracker-log-card-project-row) came to exist. At
		// that instant the row's layout only has one item competing for
		// space, so projectText.clientWidth comes out wider than it'll
		// be once Client is also present — the helper decided (with a
		// width that wasn't final yet) that no tooltip was needed.
		// Client, always measured last (with Project already present),
		// never suffered this. Fix: measure both only after inserting
		// both spans, not the helper itself (see applyTruncationTooltip).
		this.applyTruncationTooltip(projectText, project.name);
		if (clientTooltip) this.applyTruncationTooltip(clientTooltip.el, clientTooltip.text);
	}

	// Native tooltip with the full text only if the content is really
	// truncated by CSS and only on desktop — there's no hover on mobile,
	// so there's nowhere to show it. Called synchronously right after
	// inserting `el` into an already-attached DOM (the card lives inside
	// the visible panel from before this point), so layout is already
	// resolved when reading these properties — no need to wait (reading
	// clientWidth/scrollWidth forces a synchronous reflow if needed). The
	// real requirement is that `el` itself has a box with overflow:hidden
	// + text-overflow:ellipsis on a single line (see
	// .task-time-tracker-log-card-project-name and the card's title in
	// styles.css, both single-line): a <span> without those rules of its
	// own (plain display:inline) always gives clientWidth 0, so the
	// comparison never detects truncation — fixed by applying those
	// rules to the text span itself, not to a separate container.
	private applyTruncationTooltip(el: HTMLElement, fullText: string): void {
		if (Platform.isMobile) return;
		if (el.scrollWidth > el.clientWidth) setTooltip(el, fullText);
	}

	// Zone 2 — kebab menu: Edit (opens EditTaskModal with the task's
	// entire history) and Delete (same active-session guard and the
	// same whole-task delete confirmation as always).
	private openTaskMenu(anchor: HTMLElement, taskId: string, label: string, isMissing: boolean): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t("log.menuEdit"))
				.setIcon("pencil")
				.onClick(() => this.openEditTaskModal(taskId, label, isMissing)),
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

	// The active-session check uses this.getEntries() without scoping to
	// a day/week — the task can have its active session today even
	// though this particular card shows a different day (week view).
	private requestDeleteTask(taskId: string): void {
		const hasActive = this.getEntries().some((entry) => entry.taskId === taskId && entry.end === null);
		if (hasActive) {
			new Notice(t("log.deleteBlockedActive"));
			return;
		}
		this.taskDeleteConfirmId = taskId;
		void this.render();
	}

	// Opens the Edit modal with the task's entire history (not just the
	// entries scoped to this card's visible day/week) — see
	// TimeLogViewActions#getEntriesForTask.
	private openEditTaskModal(taskId: string, label: string, isMissing: boolean): void {
		new EditTaskModal(
			this.app,
			taskId,
			label,
			isMissing,
			() => this.actions.getEntriesForTask(taskId),
			this.getEntries,
			() => this.actions.getProjects(),
			this.actions.getProjectForTask(taskId),
			{
				assignProject: (id, projectId) => this.actions.assignProject(id, projectId),
				updateEntryTimes: (entryId, start, end) => this.actions.updateEntryTimes(entryId, start, end),
				deleteEntry: (entryId) => this.actions.deleteEntry(entryId),
			},
			() => void this.render(),
		).open();
	}

	// Whole-task delete confirmation. Same visible-data + Yes/Cancel
	// pattern the session edit form inside the Edit modal
	// (EditTaskModal.ts) uses, reusing the same CSS classes. Unlike the
	// normal card (whose total can come scoped to a day/week), sessions
	// and total are ALWAYS recalculated over the task's entire history
	// (this.getEntries() without a date filter): what's shown must match
	// exactly what's about to be deleted. Top to bottom order: title,
	// summary, warning, buttons (all together, no scrolling, to decide
	// and confirm) and, after a divider line, the full detail of every
	// session (renderSessionInfo, read-only, see sessionEdit.ts).
	private renderTaskDeleteConfirm(card: Element, taskId: string, label: string): void {
		const fullTaskEntries = this.getEntries().filter((entry) => entry.taskId === taskId);
		const totalMs = fullTaskEntries.reduce((sum, entry) => sum + ((entry.end ?? Date.now()) - entry.start), 0);

		const confirm = card.createDiv({ cls: "task-time-tracker-log-edit-form" });
		confirm.createDiv({ text: label, cls: "task-time-tracker-log-task" });

		// Unlike the normal card (which omits the row if there's no
		// project), here it's always shown, explicitly, since it's the
		// step right before an irreversible action (see
		// renderProjectRow()). alignWithNoteIcon=false: this title has no
		// note icon in front of it (unlike the card's), so the row must
		// align flush, without the column gap reserved for that icon.
		this.renderProjectRow(confirm, this.actions.getProjectForTask(taskId), false);

		const meta = confirm.createDiv({ cls: "task-time-tracker-log-meta" });
		meta.createSpan({
			text: `${fullTaskEntries.length} ${fullTaskEntries.length === 1 ? t("log.session.singular") : t("log.session.plural")}`,
			cls: "task-time-tracker-log-session-count",
		});
		// Same aggregate total as the card's header (same CSS class),
		// compact format — see formatDurationCompact(). No icon: unlike
		// the normal card, this confirmation can never have the active
		// session (requestDeleteTask() blocks deletion if there is one),
		// so the "adding up live" icon would never apply here.
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
		// Default focus on "Cancelar", never on the destructive button —
		// avoids an accidental delete with Enter. Deferred with
		// setTimeout: the trigger is now a Menu's "Delete" item (see
		// openTaskMenu()), and that Menu can return focus to its own
		// trigger button (the kebab) as part of its own closing AFTER
		// this render() finishes — without the defer, that focus return
		// arrived later and clobbered the focus set here.
		window.setTimeout(() => cancelBtn.focus(), 0);

		// Read-only on purpose: there's no editing path in the whole-task
		// delete confirmation — renderSessionInfo() is called directly
		// (same data: date, start time, end time, duration), with no
		// click listener or buttons.
		const detail = confirm.createDiv({ cls: "task-time-tracker-log-card-detail" });
		for (const entry of [...fullTaskEntries].sort((a, b) => b.start - a.start)) {
			const row = detail.createDiv({ cls: "task-time-tracker-log-session-row" });
			renderSessionInfo(row, entry, (el, completedMs, start) =>
				this.activeCardTicks.push({ kind: "duration", el, completedMs, start }),
			);
		}
	}

	// Opens a task's source note from its card's title (resolvePreferring:
	// prioritizes the most recent session's note if the id is duplicated
	// across several notes, with the generic first-match criterion as a
	// fallback). If the note is already open in some workspace tab, that
	// one is focused (the first one found, regardless of which is "most
	// recent" among several) instead of opening a new tab; otherwise a
	// new tab opens in the center area, same as before. Selects the
	// whole line for a moment as a highlight (there's no public API for
	// Obsidian's native search flash without touching the internal DOM).
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

	// First existing markdown tab that already has this file open, or
	// null if none. Doesn't distinguish "the most recent" among several
	// — the first one found is enough.
	private findLeafWithFile(file: TFile): WorkspaceLeaf | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
				return leaf;
			}
		}
		return null;
	}

	// Historial header layout (see docs/DECISIONS.md for the redesign
	// this replaced). Single 480px container breakpoint, shared by all 3
	// views — see the @container blocks in styles.css:
	// - Wide format (>=480px): "auto 1fr auto" grid in a single row —
	//   left: Day/Week toggle or "Volver"; center: arrows+date with NO
	//   box of its own in Day/Week, framed box (range + "· N dias") in
	//   Resultados (see formatResultsRangeTitle/formatResultsRangeDays);
	//   right: calendar+Filter, always anchored to the right edge.
	// - Compact format (<480px), 2 rows: row 1 = toggle/Volver on the
	//   left + calendar+Filter on the right (space-between); row 2 = a
	//   FULL-WIDTH framed control — in Day/Week a real stepper (grid
	//   44px 1fr 44px, touch targets on the ends, see the @container
	//   that restyles .task-time-tracker-log-datenav-range); in
	//   Resultados the same box but with no arrows or dividers, just
	//   centered text (range + metadata) — not interactive.
	// No "Hoy" button on this bar under any format — the only entry
	// point to "Hoy" is the date-picker's footer (see
	// DatePickerPopover.ts#goToToday).
	private renderDateNav(container: Element): void {
		const nav = container.createDiv({ cls: "task-time-tracker-log-datenav" });
		// Distinguishes Resultados from Day/Week for the filter button's
		// own breakpoint (see the @container on
		// .task-time-tracker-log-filter-btn-label in styles.css) — 610px
		// in Day/Week, 575px in Resultados, neither tied to the 480px
		// breakpoint that governs the rest of the header.
		nav.toggleClass("is-results", this.viewMode === "results");

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
				this.anchorDate = startOfWeek(this.anchorDate);
				void this.render();
			});
		}

		if (this.viewMode === "results") {
			// Occupies the grid's "mode" area (see
			// .task-time-tracker-log-results-back) — same slot as the
			// Day/Week toggle, aligned the same way on the left. "Volver"
			// always leads to Day view with today's date (doesn't
			// remember whether it came from Day or Week; same
			// destination as the date-picker's "Limpiar" in this mode,
			// see DatePickerPopover.ts#goToToday).
			const backBtn = row.createEl("button", { cls: "task-time-tracker-log-results-back" });
			setIcon(backBtn.createSpan(), "arrow-left");
			backBtn.createSpan({ text: t("log.resultsBack") });
			backBtn.addEventListener("click", () => {
				this.viewMode = "day";
				this.anchorDate = startOfDay(Date.now());
				void this.render();
			});

			// Selected range: a framed box (border + background, see
			// .task-time-tracker-log-results-rangebox) instead of plain
			// text — plain text looked unbalanced next to "Volver" and
			// calendar+Filter, which are controls with their own frame.
			// Occupies the grid's "range" area, the same central slot as
			// the arrows+date in Day/Week, but with no navigation arrows
			// (an arbitrary range has no "previous/next"). Text in two
			// parts: the range itself (formatResultsRangeTitle) and a
			// metadata of the full range's calendar days, both ends
			// included (formatResultsRangeDays — not just days with
			// activity, that's already covered by the subtitle).
			const rangeStart = this.resultsRangeStart as number;
			const rangeEnd = this.resultsRangeEnd as number;
			const rangeBox = row.createDiv({ cls: "task-time-tracker-log-results-rangebox" });
			rangeBox.createSpan({
				text: formatResultsRangeTitle(rangeStart, rangeEnd),
				cls: "task-time-tracker-log-results-rangebox-label",
			});
			rangeBox.createSpan({
				text: `· ${formatResultsRangeDays(rangeStart, rangeEnd)}`,
				cls: "task-time-tracker-log-results-rangebox-meta",
			});
		} else {
			const range = row.createDiv({ cls: "task-time-tracker-log-datenav-range" });
			const prevBtn = range.createEl("button", { cls: "clickable-icon task-time-tracker-icon-btn" });
			setIcon(prevBtn, "chevron-left");
			prevBtn.setAttribute("aria-label", this.viewMode === "day" ? t("log.navPrevDay") : t("log.navPrevWeek"));
			prevBtn.addEventListener("click", () => {
				this.anchorDate = addDays(this.anchorDate, this.viewMode === "day" ? -1 : -7);
				void this.render();
			});

			range.createSpan({ text: this.formatRangeLabel(), cls: "task-time-tracker-log-datenav-label" });

			const nextBtn = range.createEl("button", { cls: "clickable-icon task-time-tracker-icon-btn" });
			setIcon(nextBtn, "chevron-right");
			nextBtn.setAttribute("aria-label", this.viewMode === "day" ? t("log.navNextDay") : t("log.navNextWeek"));
			nextBtn.addEventListener("click", () => {
				this.anchorDate = addDays(this.anchorDate, this.viewMode === "day" ? 1 : 7);
				void this.render();
			});
		}

		// Atomic calendar+Filter group: they never separate from each
		// other or change position (always anchored to the row's right
		// edge, see the CSS grid-area on
		// .task-time-tracker-log-datenav-actions) — this wrapper is what
		// keeps them together as a single layout unit instead of two
		// loose elements the grid could separate.
		const actions = row.createDiv({ cls: "task-time-tracker-log-datenav-actions" });
		const calendarBtn = actions.createEl("button", {
			cls: "task-time-tracker-log-datenav-calendar task-time-tracker-log-header-icon-btn task-time-tracker-icon-btn",
		});
		// render() rebuilds this whole bar from scratch (container.empty()
		// in render()), including this button — also in the render
		// triggered by the picker's own onChange when a selection is
		// applied. Reanchors the popover (if open) to the new button so
		// the "outside click" listener and the open/close singleton
		// don't keep comparing against the old, already-unmounted button
		// (see docs/DECISIONS.md). A no-op if no popover is open.
		reanchorDatePickerPopover(calendarBtn);
		// "Active date filter" isn't a separate state of its own (unlike
		// the project filter, date navigation always shows some
		// day/week, never "none") — it's derived from whether the panel
		// is showing anything other than "today in Day view". Same
		// visual treatment (is-active) as the filter button when a
		// project is selected, so the user notices at a glance that
		// they're not viewing the default date. No text pill (unlike the
		// filter): the date is already shown in the row below, showing
		// it here too would duplicate it.
		const isDateFilterActive = !(this.viewMode === "day" && isSameLocalDay(this.anchorDate, startOfDay(Date.now())));
		calendarBtn.toggleClass("is-active", isDateFilterActive);
		setIcon(calendarBtn, "calendar");
		calendarBtn.setAttribute("aria-label", t("log.datePickerAriaLabel"));
		setTooltip(calendarBtn, t("log.datePickerAriaLabel"));
		calendarBtn.addEventListener("click", () => {
			// The already-active range's end, so the picker marks it in
			// full on reopening: Week is anchorDate+6 days (Monday to
			// Sunday, see [[Vista de resultados por rango]] and
			// renderDateNav), Resultados is the saved range end; Day has
			// no range, a lone day.
			const selectedRangeEnd =
				this.viewMode === "week"
					? addDays(this.anchorDate, 6)
					: this.viewMode === "results"
						? (this.resultsRangeEnd as number)
						: this.anchorDate;
			openDatePickerPopover({
				anchorEl: calendarBtn,
				selectedDate: this.viewMode === "results" ? (this.resultsRangeStart as number) : this.anchorDate,
				selectedRangeEnd,
				// The picker doesn't distinguish "click on the week number"
				// from "a day range that turns out to be exactly a week"
				// — both arrive here as the same (start, end), and it
				// doesn't matter: both must jump to Week view. Any other
				// range (neither a single day nor a full week) enters
				// Resultados mode — see renderResultsSection().
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

		this.renderProjectFilter(actions);
	}

	// Project filter button, next to the calendar: just the "filter"
	// icon at rest (same look as the calendar button — see
	// .task-time-tracker-log-header-icon-btn), the selected project's
	// name (or "No project") + a tinted background in active state. The
	// "x" icon to clear the filter is an independent button (its own
	// hit-area), only present in active state — deliberately separate
	// from the main button, which only opens/closes the popover.
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
		// No selection: just the icon (same look as the calendar
		// button). With a selection: the project's name or "No project",
		// same as it already showed before — the icon-only look is
		// exclusive to rest state, not active state.
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

	// Replaces the normal day/week empty state only when a project
	// filter is active and the whole visible range (the day, or the
	// week's 7 days) has no session of that project — a lone empty day
	// inside a week with results on other days still shows the normal
	// "No sessions this day" (see render()).
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

	// Short date format (day): "Mié, 12 ago 2026" instead of the earlier
	// long form ("miércoles, 12 de agosto de 2026") — the navigation bar
	// no longer needs to compete in width with the toggle and the Hoy
	// button on the same line. Intl gives the day/month name in
	// lowercase (es locale); only the first letter is capitalized by
	// hand, not the whole string (text-transform: capitalize would also
	// capitalize "ago").
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

	// Same criterion as formatRangeLabel() (see docs/DECISIONS.md for why
	// CSS text-transform: capitalize isn't used instead): Intl gives the
	// day/month name in lowercase (es locale), only the first letter is
	// capitalized by hand.
	private formatDayHeading(dayStart: number): string {
		const label = new Date(dayStart).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
		return label.charAt(0).toUpperCase() + label.slice(1);
	}

	// Each day's heading inside Week/Resultados: title + connector line
	// filling the space + the day's total on the right, instead of the
	// earlier standalone <h6>. Empty dayEntries (only arrives this way
	// from Week — Resultados never calls here with an empty day, see
	// renderDaySection#hideIfEmpty) shows a dimmed "—" instead of a real
	// total. Still a real <h6> (heading semantics for screen readers),
	// with the row layout resolved by CSS.
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
		// Icon only if THIS day has the active session (same criterion as
		// renderTaskCard() and renderViewTotal()) — a "live" indicator,
		// not fixed decoration.
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

	// Bounds (start included, end excluded) of the currently visible
	// range, per viewMode — the same calculation renderViewTotal() used
	// to do on its own, now shared with renderSubtitle() ("N tareas · M
	// sesiones/dias").
	private getViewRangeBounds(): { start: number; end: number } {
		if (this.viewMode === "results") {
			return { start: this.resultsRangeStart as number, end: addDays(this.resultsRangeEnd as number, 1) };
		}
		const start = this.viewMode === "day" ? startOfDay(this.anchorDate) : startOfWeek(this.anchorDate);
		const end = this.viewMode === "day" ? addDays(start, 1) : addDays(start, 7);
		return { start, end };
	}

	// Subtitle under "Time Tracker": "N tareas · M sesiones" in Day, "N
	// tareas · M dias con actividad" in Week/Resultados — never "N
	// tareas · 1 dia con actividad" in Day (a trivial fact on a single
	// day). allEntries already arrives scoped by the project filter (see
	// render()), here it's only further scoped to the visible date range.
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

	// One section per day: filters allEntries to those that started
	// (entry.start) on that local calendar day, and shows a reasonable
	// empty state if there are none. withHeading is only used in week
	// view and in Resultados (one section per day); in day view the
	// section's title is already given by the navigation bar, so it
	// doesn't need repeating. hideIfEmpty (Resultados, see
	// renderResultsSection()): a day with no sessions isn't shown at
	// all, not even its heading — it's a results list, not a calendar,
	// unlike Week, where the heading + "No sessions this day" IS shown
	// for every empty day.
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
		// A more recent render() call already took control of the
		// container while this section's tt-ids were being resolved —
		// see the renderToken comment. Aborting here avoids duplicating
		// cards on top of that more recent call's (already correct)
		// result.
		if (token !== this.renderToken) return;
		this.renderTaskList(container, dayEntries, resolutions, dayStart);
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const container = this.containerEl.children[1];
		if (!container) return;

		const allEntries = this.getEntries();
		// Recomputed from scratch on every render(): if the active card
		// isn't rendered again (e.g. navigating to another date), the
		// tick stops having any effect instead of pointing at an
		// already-unmounted node.
		this.activeCardTicks = [];

		container.empty();

		if (allEntries.length === 0) {
			container.createEl("h4", { text: t("log.title") });
			container.createEl("p", { text: t("log.emptyAll") });
			return;
		}

		// Project filter (see renderProjectFilter()): scopes the ENTIRE
		// visible listing (header total, navigation included) to entries
		// of tasks assigned to that project — allEntries (unfiltered) is
		// kept above only to decide the plugin's global empty state ("No
		// sessions recorded yet"), which has nothing to do with the
		// filter.
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

	// Range results view: grouped by day (heading + cards, see
	// renderDaySection with hideIfEmpty), with no empty days interspersed.
	// Paginated in blocks of RESULTS_PAGE_DAYS days — a range can be
	// arbitrarily wide (no limit in the date-picker), but resolving
	// hundreds/thousands of days (the vast majority empty) all at once
	// makes no sense; "Cargar mas" only appears if the full range
	// exceeds what's already loaded. The title row's total (see
	// renderViewTotal) ALWAYS covers the full range, not just what's
	// loaded — it's computed separately, it doesn't depend on this loop.
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

	// "Quitar filtros" (plural): Resultados' empty range can be due to
	// the date range, the project/"No project" filter, or a combination
	// of both — unlike renderFilteredEmptyState (which can only be due
	// to the project filter, no range in Day/Week), there's no way to
	// tell the cause apart here, so the button clears both at once and
	// always returns to Day/today (same destination as
	// "Volver"/"Limpiar" in this mode).
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

		const clearBtn = wrap.createEl("button", { text: t("log.resultsFilterRemoveButton") });
		clearBtn.addEventListener("click", () => {
			this.viewMode = "day";
			this.anchorDate = startOfDay(Date.now());
			this.projectFilterId = null;
			this.projectFilterNoProject = false;
			void this.render();
		});
	}

	// Total time tracked in the current view (day, week, or Resultados'
	// full range — never just the already-loaded part if there's
	// pagination, see renderResultsSection()), next to the title. Unlike
	// each card's compact total (formatDurationCompact), this one uses
	// formatDuration (HH:MM:SS): it's a single standout number, not a
	// list of per-task totals where the compact format avoids visually
	// competing with each card's title.
	private renderViewTotal(container: Element, allEntries: TimeEntry[]): void {
		const { start: rangeStart, end: rangeEnd } = this.getViewRangeBounds();
		const viewEntries = allEntries.filter((entry) => entry.start >= rangeStart && entry.start < rangeEnd);

		const activeEntry = viewEntries.find((entry) => entry.end === null) ?? null;
		const completedMs = viewEntries
			.filter((entry) => entry.end !== null)
			.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
		const totalMs = completedMs + (activeEntry ? Date.now() - activeEntry.start : 0);

		// "Total del rango" label: the same data as always (the visible
		// range's total, ticking up live if there's an active session),
		// just with a label added above it — most useful in Resultados,
		// which has no implicit "today"/"this week".
		const totalCol = container.createDiv({ cls: "task-time-tracker-log-total-col" });
		totalCol.createSpan({ text: t("log.rangeTotalLabel"), cls: "task-time-tracker-log-total-label" });
		const totalGroup = totalCol.createSpan({ cls: "task-time-tracker-totals-duration-group" });
		// Icon only if the active session falls inside the visible range
		// — same criterion as in renderTaskCard() and renderDayHeading().
		if (activeEntry) {
			setIcon(totalGroup.createSpan({ cls: "task-time-tracker-totals-duration-icon" }), "clock");
		}
		// task-time-tracker-log-view-total-value: large scale (22px in
		// the prototype) exclusive to this header total — the base class
		// task-time-tracker-totals-duration stays at the small scale the
		// task card and the delete confirmation share.
		const value = totalGroup.createSpan({
			text: formatDuration(totalMs),
			cls: "task-time-tracker-totals-duration task-time-tracker-log-view-total-value",
		});

		if (activeEntry) {
			this.activeCardTicks.push({ kind: "duration", el: value, completedMs, start: activeEntry.start });
		}
	}
}
