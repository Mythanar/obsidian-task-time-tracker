import { Editor, MarkdownFileInfo, MarkdownView, Menu, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { TrackingEngine } from "./core/TrackingEngine";
import { ProjectManager } from "./core/ProjectManager";
import { StateStore } from "./core/StateStore";
import {
	extractCheckboxState,
	extractTaskId,
	ensureTaskId,
	isClosedCheckboxState,
	parseCheckboxLine,
	TaskIdentifier,
} from "./core/TaskIdentifier";
import { StatusBarWidget } from "./ui/StatusBarWidget";
import { TimeLogView, TIME_LOG_VIEW_TYPE } from "./ui/TimeLogView";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./ui/DashboardView";
import { RecoveryModal } from "./ui/RecoveryModal";
import { ExportModal, ExportFormat } from "./ui/ExportModal";
import { ExportManager } from "./export/ExportManager";
import { SettingsTab } from "./settings/SettingsTab";
import { DeleteTaskResult, EntryUpdateResult, PluginSettings, PluginState, TimeEntry } from "./types";
import { InlineTrackingBus } from "./ui/InlineTrackingBus";
import { createInlineTaskControlExtension } from "./ui/InlineTaskControlExtension";
import { t } from "./i18n";

/**
 * Task Time Tracker
 *
 * A closed task ([x] or [-]) can't be tracked; if it closes while
 * active, tracking stops on its own. Play/stop badge next to the
 * checkbox (Edit mode only) to start and stop tracking without using
 * the command.
 * Local-first: start/stop and persistence don't depend on network;
 * export is always a manual push, never real-time sync; no export
 * adapter calls an external API.
 */

// When the checkbox is checked in Edit mode, Obsidian saves the change
// to disk (and fires vault.on("modify")) with the editor's own ~2s
// debounce. To not depend on that delay, workspace.on("editor-change")
// is also listened to, reading the editor's live content; this own
// (much shorter) debounce avoids reacting to a transient line state
// while the user is still editing.
const EDITOR_CHANGE_DEBOUNCE_MS = 300;

// See applyTaskIdFormatClass().
const TASKID_FORMAT_BODY_CLASSES = ["task-time-tracker-taskid-reduced", "task-time-tracker-taskid-hidden"];

export default class TaskTimeTrackerPlugin extends Plugin {
	trackingEngine!: TrackingEngine;
	projectManager!: ProjectManager;
	statusBarWidget!: StatusBarWidget;
	taskIdentifier!: TaskIdentifier;
	exportManager!: ExportManager;
	store!: StateStore;
	private editorChangeDebounceTimer: number | null = null;
	private inlineControlsBus = new InlineTrackingBus();

	// The in-memory state lives in StateStore and is replaced wholesale
	// after every write (read-before-write, see core/StateStore.ts), so it
	// is exposed as a getter: no consumer can hold on to a captured
	// reference to the state object.
	get pluginState(): PluginState {
		return this.store.getState();
	}

	async onload() {
		this.store = new StateStore({
			load: () => this.loadData(),
			save: (state) => this.saveData(state),
		});
		await this.store.init();
		this.applyTaskIdFormatClass();

		this.trackingEngine = new TrackingEngine(this.store);
		this.projectManager = new ProjectManager(this.store);
		this.taskIdentifier = new TaskIdentifier(this.app);
		this.exportManager = new ExportManager(this.app, this.taskIdentifier, this.projectManager);
		this.statusBarWidget = new StatusBarWidget(
			this,
			() => this.trackingEngine.getActiveEntry(),
			() => void this.handleStatusBarClick(),
		);
		this.addSettingTab(new SettingsTab(this.app, this));

		this.registerView(
			TIME_LOG_VIEW_TYPE,
			(leaf) =>
				new TimeLogView(leaf, () => this.trackingEngine.getEntries(), this.taskIdentifier, {
					updateEntryTimes: (entryId, start, end) => this.updateEntryTimes(entryId, start, end),
					deleteEntry: (entryId) => this.deleteEntry(entryId),
					deleteTask: (taskId) => this.deleteTask(taskId),
					stopTracking: () => this.handleInlineStop(),
					resumeTracking: (taskId) => this.resumeTracking(taskId),
					getEntriesForTask: (taskId) => this.trackingEngine.getEntries().filter((e) => e.taskId === taskId),
					getProjects: () => this.projectManager.getProjects(),
					getProjectForTask: (taskId) => this.projectManager.getProjectForTask(taskId),
					assignProject: (taskId, projectId) => this.projectManager.assignProject(taskId, projectId),
					bus: this.inlineControlsBus,
				}),
		);

		this.registerView(
			DASHBOARD_VIEW_TYPE,
			(leaf) =>
				new DashboardView(leaf, () => this.trackingEngine.getEntries(), this.taskIdentifier, {
					getProjectForTask: (taskId) => this.projectManager.getProjectForTask(taskId),
					openHistory: () => void this.activateLogView(),
				}),
		);

		// "Informe de rendimiento" isn't built or scheduled for this
		// version; it's left out of the menu until it's built (see
		// CLAUDE.md, "Trabajo en curso"). The menu is kept (instead of
		// opening the Dashboard directly on click) so that entry can be
		// added back without another structural change.
		this.addRibbonIcon("bar-chart-3", t("ribbon.tooltip"), (evt: MouseEvent) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle(t("ribbon.dashboardItem"))
					.setIcon("bar-chart-3")
					.onClick(() => void this.activateDashboardView()),
			);
			menu.showAtMouseEvent(evt);
		});

		// Fallback: covers edits that don't go through an editor open in
		// Obsidian (external edits to the vault, sync between devices, or
		// the editor's own save to disk after its internal debounce).
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				void this.handleFileModified(file);
			}),
		);

		// Fast path: reacts to the editor's live content without waiting
		// for the save to disk (see EDITOR_CHANGE_DEBOUNCE_MS).
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor) => {
				this.scheduleEditorChangeCheck(editor);
			}),
		);
		this.register(() => {
			if (this.editorChangeDebounceTimer !== null) {
				window.clearTimeout(this.editorChangeDebounceTimer);
			}
		});

		// Play/stop badge next to the checkbox, Edit mode only
		// (CodeMirror). The per-second tick only fires if there's an
		// active session, to avoid wasted work when nothing is running.
		const inlineControlDeps = {
			getActiveEntry: () => this.trackingEngine.getActiveEntry(),
			getAccumulatedMs: (taskId: string) => this.trackingEngine.getAccumulatedMs(taskId),
			bus: this.inlineControlsBus,
			onStart: (taskId: string, taskText: string, filePath: string) =>
				void this.handleInlineStart(taskId, taskText, filePath),
			onStop: () => void this.handleInlineStop(),
		};
		this.registerEditorExtension(createInlineTaskControlExtension(inlineControlDeps));
		this.registerInterval(
			window.setInterval(() => {
				if (this.trackingEngine.getActiveEntry()) this.inlineControlsBus.notify();
			}, 1000),
		);

		this.addCommand({
			id: "start-tracking-current-task",
			name: t("cmd.start"),
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) =>
				this.startTrackingFromCursor(editor, ctx),
		});

		this.addCommand({
			id: "stop-active-tracking",
			name: t("cmd.stop"),
			callback: async () => {
				const stopped = await this.stopActiveTracking();
				if (!stopped) {
					new Notice(t("notice.noActiveSession"));
				}
				this.statusBarWidget.refresh();
				this.refreshLogViews();
				this.notifyTrackingChanged();
			},
		});

		this.addCommand({
			id: "open-time-log-panel",
			name: t("cmd.openLog"),
			callback: () => this.activateLogView(),
		});

		this.addCommand({
			id: "open-dashboard-view",
			name: t("cmd.openDashboard"),
			callback: () => this.activateDashboardView(),
		});

		this.addCommand({
			id: "export-time-entries",
			name: t("cmd.export"),
			callback: () => {
				new ExportModal(
					this.app,
					this.pluginState.settings.toggl,
					(email) => this.saveTogglEmail(email),
					(value) => this.saveTogglIncludeProjectClient(value),
					this.pluginState.settings.clockify,
					(email) => this.saveClockifyEmail(email),
					(value) => this.saveClockifyIncludeProject(value),
					(value) => this.saveClockifyIncludeClient(value),
					(fromValue, toValue, format) => {
						void this.runExport(fromValue, toValue, format);
					},
				).open();
			},
		});

		const active = this.trackingEngine.getActiveEntry();
		if (active) {
			new RecoveryModal(
				this.app,
				active,
				() => {
					void this.stopActiveTracking().then(() => {
						this.statusBarWidget.refresh();
						this.refreshLogViews();
						this.notifyTrackingChanged();
					});
				},
				() => {
					this.statusBarWidget.refresh();
				},
			).open();
		}
	}

	onunload() {
		document.body.classList.remove(...TASKID_FORMAT_BODY_CLASSES);
	}

	// Obsidian calls this when data.json changes outside this device
	// (Obsidian Sync delivering another machine's changes, or a manual edit
	// of the file). It only re-reads and refreshes the UI: observing an
	// external change never justifies a save, and a re-read can neither
	// create nor stop a timer — the active timer is still, as always,
	// whichever session with end === null the disk reports.
	async onExternalSettingsChange(): Promise<void> {
		await this.store.reload();
		this.applyTaskIdFormatClass();
		this.statusBarWidget.refresh();
		this.refreshLogViews();
		this.notifyTrackingChanged();
	}

	// Fase 7 — aplica (o retira) la clase en document.body que activa el
	// CSS correspondiente en styles.css (ver ajuste "Formato del id de
	// tarea" en SettingsTab.ts). "normal" no lleva clase: es el
	// comportamiento por defecto de Dataview, sin CSS del plugin.
	applyTaskIdFormatClass(): void {
		document.body.classList.remove(...TASKID_FORMAT_BODY_CLASSES);
		const format = this.pluginState.settings.taskIdFormat;
		if (format === "reduced") document.body.classList.add("task-time-tracker-taskid-reduced");
		else if (format === "hidden") document.body.classList.add("task-time-tracker-taskid-hidden");
	}

	private async startTrackingFromCursor(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): Promise<void> {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const taskText = parseCheckboxLine(line);
		if (taskText === null) {
			new Notice(t("notice.notATask"));
			return;
		}

		if (isClosedCheckboxState(extractCheckboxState(line))) {
			new Notice(t("notice.taskClosed"));
			return;
		}

		const { taskId, updatedLine } = ensureTaskId(line);
		if (updatedLine !== line) {
			editor.setLine(cursor.line, updatedLine);
		}

		const filePath = ctx.file?.path ?? "";
		const result = await this.trackingEngine.start(taskId, taskText, filePath);
		if (result === "already-active") {
			new Notice(t("notice.alreadyTracking"));
			return;
		}

		this.statusBarWidget.refresh();
		this.refreshLogViews();
		this.notifyTrackingChanged();
	}

	// Fallback for files not open in any editor: vault.on("modify") fires
	// just the same (Obsidian already wrote the file to disk), so
	// reading it from the vault is enough. Also the general path that
	// keeps the Historial panel's checkbox state (closed/reopened) in
	// sync with a note edited directly, outside the panel — see
	// refreshLogViewsIfTracked().
	private async handleFileModified(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || file.extension !== "md") return;

		const hasActive = this.trackingEngine.getActiveEntry() !== null;
		const panelOpen = this.hasTimeLogViewOpen();
		if (!hasActive && !panelOpen) return;

		const content = await this.app.vault.cachedRead(file);
		if (hasActive) await this.stopIfActiveTaskClosedIn(content);
		if (panelOpen) this.refreshLogViewsIfTracked(content);
	}

	// Short debounce: every keystroke reschedules the check, so the
	// content is only evaluated once the user stops typing on that line
	// for EDITOR_CHANGE_DEBOUNCE_MS. A transient "[x]"/"[-]" state
	// mid-edit never gets evaluated if it's corrected before the delay
	// expires. Same dual purpose as handleFileModified above (auto-stop +
	// keeping the panel in sync), just on the fast path for a note that's
	// open in an editor, without waiting for the editor's own save-to-
	// disk debounce.
	private scheduleEditorChangeCheck(editor: Editor): void {
		if (!this.trackingEngine.getActiveEntry() && !this.hasTimeLogViewOpen()) return;

		if (this.editorChangeDebounceTimer !== null) {
			window.clearTimeout(this.editorChangeDebounceTimer);
		}
		this.editorChangeDebounceTimer = window.setTimeout(() => {
			this.editorChangeDebounceTimer = null;
			const content = editor.getValue();
			if (this.trackingEngine.getActiveEntry()) void this.stopIfActiveTaskClosedIn(content);
			if (this.hasTimeLogViewOpen()) this.refreshLogViewsIfTracked(content);
		}, EDITOR_CHANGE_DEBOUNCE_MS);
	}

	// Looks for the active session's line by its tt-id in the given
	// content (from a live editor or a file read from the vault) and, if
	// its checkbox is closed, stops tracking the same as a manual "Stop
	// tracking".
	private async stopIfActiveTaskClosedIn(content: string): Promise<void> {
		const active = this.trackingEngine.getActiveEntry();
		if (!active) return;

		for (const line of content.split("\n")) {
			if (extractTaskId(line) !== active.taskId) continue;
			if (isClosedCheckboxState(extractCheckboxState(line))) {
				await this.stopActiveTracking();
				this.statusBarWidget.refresh();
				this.refreshLogViews();
				this.notifyTrackingChanged();
			}
			return;
		}
	}

	private hasTimeLogViewOpen(): boolean {
		return this.app.workspace.getLeavesOfType(TIME_LOG_VIEW_TYPE).length > 0;
	}

	// Keeps the Historial panel reacting live to a checkbox toggled
	// (closed OR reopened) directly in a note, outside the panel — e.g.
	// unchecking a task the panel still shows as closed. Cheap discard
	// first (no "[tt-id::" substring at all) before the line-by-line scan,
	// so an edit to a note with no tracked task never reaches
	// refreshLogViews(); note content check only runs against the ids this
	// device already has history for, not the whole vault.
	private refreshLogViewsIfTracked(content: string): void {
		if (!content.includes("[tt-id::")) return;

		const trackedIds = new Set(this.trackingEngine.getEntries().map((entry) => entry.taskId));
		if (trackedIds.size === 0) return;

		for (const line of content.split("\n")) {
			const taskId = extractTaskId(line);
			if (taskId && trackedIds.has(taskId)) {
				this.refreshLogViews();
				return;
			}
		}
	}

	// Inline control: starts/stops tracking from the play/stop badge
	// next to the checkbox (Edit mode). The control itself
	// (InlineTaskControlExtension) already made sure the line has a
	// tt-id before calling here; this function only moves
	// TrackingEngine's state, same as the command.
	private async handleInlineStart(taskId: string, taskText: string, filePath: string): Promise<void> {
		const result = await this.trackingEngine.start(taskId, taskText, filePath);
		if (result !== "started") return;
		this.statusBarWidget.refresh();
		this.refreshLogViews();
		this.notifyTrackingChanged();
	}

	private async handleInlineStop(): Promise<void> {
		const stopped = await this.stopActiveTracking();
		if (!stopped) return;
		this.statusBarWidget.refresh();
		this.refreshLogViews();
		this.notifyTrackingChanged();
	}

	// "Retomar tracking de una tarea ya registrada" — starts a new
	// session for a tt-id that already has history, from its card's play
	// button in the Historial. Doesn't read or write the source note
	// (unlike startTrackingFromCursor/handleInlineStart): the new
	// TimeEntry's taskText/filePath are the snapshot of that task's most
	// recently saved session, so it works the same whether the note was
	// edited or deleted since. Never reopens the previous session —
	// trackingEngine.start() always creates a new entry.
	private async resumeTracking(taskId: string): Promise<void> {
		const taskEntries = this.trackingEngine.getEntries().filter((entry) => entry.taskId === taskId);
		if (taskEntries.length === 0) return;
		const mostRecent = taskEntries.reduce((latest, entry) => (entry.start > latest.start ? entry : latest));

		const result = await this.trackingEngine.start(taskId, mostRecent.taskText, mostRecent.filePath);
		if (result !== "started") return;

		this.statusBarWidget.refresh();
		this.refreshLogViews();
		this.notifyTrackingChanged();
	}

	// Single point where the active session closes and the TimeEntry is
	// saved: every stop flow (command, RecoveryModal, inline control,
	// auto-stop on closing the checkbox in stopIfActiveTaskClosedIn)
	// goes through here instead of calling trackingEngine.stop() on its
	// own, so the tt-id's repositioning (see repositionTaskId() in
	// TaskIdentifier.ts) is always applied in the same place. Covers the
	// case where the task was hand-edited while running and the tt-id
	// ended up misplaced — the fix applied when tracking starts doesn't
	// reach a later edit made while it's running.
	private async stopActiveTracking(): Promise<TimeEntry | null> {
		const stopped = await this.trackingEngine.stop();
		if (stopped) {
			await this.taskIdentifier.repositionTaskId(stopped.taskId);
		}
		return stopped;
	}

	// Notifies the already-mounted inline controls (icon next to the
	// checkbox) that the tracking state changed, so they update
	// icon/badge without waiting for the 1s tick. No need to force a
	// rebuild of CodeMirror's decorations: every already-mounted widget
	// is subscribed to this bus and redraws itself (see
	// InlineTaskControlExtension.ts).
	private notifyTrackingChanged(): void {
		this.inlineControlsBus.notify();
	}

	private async runExport(fromValue: string, toValue: string, format: ExportFormat): Promise<void> {
		const fromMs = new Date(`${fromValue}T00:00:00`).getTime();
		const toMs = new Date(`${toValue}T23:59:59.999`).getTime();
		const exportsFolder = this.pluginState.settings.exportsFolder;

		try {
			let filePath: string;
			if (format === "toggl") {
				filePath = await this.exportManager.exportToTogglCsv(
					this.trackingEngine.getEntries(),
					fromMs,
					toMs,
					this.pluginState.settings.toggl,
					exportsFolder,
				);
			} else if (format === "clockify") {
				filePath = await this.exportManager.exportToClockifyCsv(
					this.trackingEngine.getEntries(),
					fromMs,
					toMs,
					this.pluginState.settings.clockify,
					exportsFolder,
				);
			} else {
				filePath = await this.exportManager.exportToCsv(this.trackingEngine.getEntries(), fromMs, toMs, exportsFolder);
			}
			new Notice(t("notice.exportSuccess", { filePath }));
		} catch (error) {
			console.error("Task Time Tracker: error exportando a CSV", error);
			new Notice(t("notice.exportError"));
		}
	}

	// Settings' "Export all" button: general good practice before an
	// uninstall, since the Obsidian API doesn't let you intercept the
	// exact moment a user uninstalls a plugin (there's no technical way
	// to be warned "just before"). Same path as runExport() with the
	// generic CSV format and the full range precomputed (from the first
	// session to now) — no modal, no range or format selection, one
	// click. The active session (if there is one) is left out just like
	// in any other export: exportToCsv() already filters by
	// entry.end !== null.
	async exportAllEntriesToCsv(): Promise<void> {
		const entries = this.trackingEngine.getEntries();
		if (entries.length === 0) {
			new Notice(t("notice.noSessionsYet"));
			return;
		}

		const fromMs = Math.min(...entries.map((entry) => entry.start));
		const toMs = Date.now();

		try {
			const filePath = await this.exportManager.exportToCsv(
				entries,
				fromMs,
				toMs,
				this.pluginState.settings.exportsFolder,
			);
			new Notice(t("notice.exportSuccess", { filePath }));
		} catch (error) {
			console.error("Task Time Tracker: error exportando a CSV", error);
			new Notice(t("notice.exportError"));
		}
	}

	// "Update tasks" button in Settings > Tasks compatibility — walks the
	// vault once, on demand, fixing tasks tracked with an older version
	// that left the tt-id behind Tasks' metadata (see appendTaskId() and
	// fixMisplacedTaskIds() in TaskIdentifier.ts, which do all the real
	// work).
	async fixMisplacedTaskIds(): Promise<void> {
		const { reviewed, fixed } = await this.taskIdentifier.fixMisplacedTaskIds();
		const params = { reviewed: String(reviewed), fixed: String(fixed) };
		new Notice(fixed > 0 ? t("notice.tasksCompatResult", params) : t("notice.tasksCompatResultNone", params));
	}

	// The export modal lets the Toggl email be filled in right there if
	// missing; on confirm, it's persisted here as the same Settings >
	// Toggl > Email setting (single source of truth), never as a value
	// exclusive to that export.
	private async saveTogglEmail(email: string): Promise<void> {
		await this.updateSettings((settings) => {
			settings.toggl.email = email;
		});
	}

	// Export modal's "Include Project and Client" checkbox: same source
	// of truth as Settings > Toggl (see SettingsTab.ts), persisted
	// instantly on check/uncheck, not on confirming the export (unlike
	// the email, it has no invalid intermediate state to protect).
	private async saveTogglIncludeProjectClient(value: boolean): Promise<void> {
		await this.updateSettings((settings) => {
			settings.toggl.includeProjectClient = value;
		});
	}

	// Same pattern as saveTogglEmail: the export modal persists the
	// Clockify email typed right there, as the same Settings > Clockify
	// > Email setting (single source of truth).
	private async saveClockifyEmail(email: string): Promise<void> {
		await this.updateSettings((settings) => {
			settings.clockify.email = email;
		});
	}

	// Same pattern as saveTogglIncludeProjectClient: export modal's
	// "Include Project" checkbox, same source of truth as Settings >
	// Clockify, persisted instantly. Independent of "Include Client"
	// (see saveClockifyIncludeClient) — Project isn't actually required
	// by Clockify's CSV importer (see docs/DECISIONS.md).
	private async saveClockifyIncludeProject(value: boolean): Promise<void> {
		await this.updateSettings((settings) => {
			settings.clockify.includeProject = value;
		});
	}

	// Same pattern as saveTogglIncludeProjectClient: export modal's
	// "Include Client" checkbox, same source of truth as Settings >
	// Clockify, persisted instantly.
	private async saveClockifyIncludeClient(value: boolean): Promise<void> {
		await this.updateSettings((settings) => {
			settings.clockify.includeClient = value;
		});
	}

	// The single write path for settings: applies the change to the state
	// just read from disk, so touching a setting never clobbers sessions or
	// projects created on another device.
	async updateSettings(fn: (settings: PluginSettings) => void): Promise<void> {
		await this.store.updateSettings(fn);
	}

	// Historial panel: inline editing of a closed session's start/end.
	// The overlap warning with another session is computed live on
	// TimeLogView's side while editing, not here — saving is never
	// blocked by it.
	//
	// Handled here, via StateStore, instead of adding methods to
	// TrackingEngine — its responsibility is still only the active timer.
	// The session is looked up in the state just read from disk, so the
	// rest of the history (including anything that arrived by sync from
	// another device) is left untouched.
	async updateEntryTimes(entryId: string, start: number, end: number): Promise<EntryUpdateResult> {
		if (end <= start) return { ok: false, error: "invalid-range" };

		const result = await this.store.apply<EntryUpdateResult>((state) => {
			const entry = state.entries.find((e) => e.id === entryId);
			if (!entry || entry.end === null) {
				return { result: { ok: false, error: "not-found" }, changed: false };
			}
			entry.start = start;
			entry.end = end;
			return { result: { ok: true } };
		});
		if (!result.ok) return result;

		this.refreshLogViews();
		this.notifyTrackingChanged();
		return result;
	}

	// Historial panel: permanent deletion of a closed session (the
	// confirmation lives in the UI, here it's already assumed confirmed).
	async deleteEntry(entryId: string): Promise<void> {
		const deleted = await this.store.deleteEntry(entryId);
		if (!deleted) return;
		this.refreshLogViews();
		this.notifyTrackingChanged();
	}

	// Historial panel: deleting a whole task, its entire history by
	// tt-id (including sessions from other notes if the id is
	// duplicated — same criterion of treating duplicates as the same
	// task). Never touches the note: whatever [tt-id:: ...] is left on
	// the task's line is left intact and orphaned on purpose; if the
	// user tracks that line again, it simply starts a new history under
	// the same id. Blocked while that task has the active session (the
	// confirmation lives in the UI, here it's already assumed confirmed
	// except for this block).
	async deleteTask(taskId: string): Promise<DeleteTaskResult> {
		// The active-session guard is re-evaluated against the latest state
		// from disk: the task may be running on another device.
		const result = await this.store.apply<DeleteTaskResult>((state) => {
			const active = state.entries.find((e) => e.end === null) ?? null;
			if (active?.taskId === taskId) {
				return { result: { ok: false, error: "active" }, changed: false };
			}
			let removed = 0;
			for (let i = state.entries.length - 1; i >= 0; i--) {
				if (state.entries[i]?.taskId === taskId) {
					state.entries.splice(i, 1);
					removed++;
				}
			}
			return { result: { ok: true }, changed: removed > 0 };
		});
		if (!result.ok) return result;

		this.refreshLogViews();
		this.notifyTrackingChanged();
		return result;
	}

	// Public: also called by ProjectsSection.ts (via SettingsTab.ts)
	// after deleting a project, so the Historial cards that had it
	// assigned drop the Project/Client row without waiting for an
	// external panel refresh.
	refreshLogViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_LOG_VIEW_TYPE)) {
			if (leaf.view instanceof TimeLogView) leaf.view.refresh();
		}
		for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
			if (leaf.view instanceof DashboardView) leaf.view.refresh();
		}
	}

	// The location (sidebar/tab) is only decided when creating a new
	// leaf; an already-open panel is revealed where it already was,
	// without moving it (see SettingsTab.ts). Returns the opened view (or
	// null if a leaf couldn't be obtained) so callers that need to act on
	// it afterward — see handleStatusBarClick() — don't have to re-look it
	// up themselves.
	private async activateLogView(): Promise<TimeLogView | null> {
		const existing = this.app.workspace.getLeavesOfType(TIME_LOG_VIEW_TYPE);
		if (existing[0]) {
			await this.app.workspace.revealLeaf(existing[0]);
			return existing[0].view instanceof TimeLogView ? existing[0].view : null;
		}

		const leaf: WorkspaceLeaf | null =
			this.pluginState.settings.logViewLocation === "tab"
				? this.app.workspace.getLeaf("tab")
				: this.app.workspace.getRightLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({ type: TIME_LOG_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
		return leaf.view instanceof TimeLogView ? leaf.view : null;
	}

	// Status bar footer click (see "Footer de status"): always opens the
	// Historial panel AND navigates it to today's Day view, with or
	// without an active session — no longer conditional on tracking being
	// active. If a session IS active, it also scrolls/flashes that task's
	// row — same destination as the "go to Today" indicator on that
	// task's card elsewhere in the panel (see
	// TimeLogView.ts#navigateToTrackedTask); with none active, taskId is
	// null and there's simply nothing to highlight once there.
	private async handleStatusBarClick(): Promise<void> {
		const view = await this.activateLogView();
		const active = this.trackingEngine.getActiveEntry();
		if (view) view.navigateToTrackedTask(active ? active.taskId : null);
	}

	// Dashboard — always in a tab of the main workspace, no location
	// setting (unlike the Historial): it isn't a sidebar-style quick
	// lookup panel, it's a single full-screen view (see the "Dashboard"
	// brief).
	private async activateDashboardView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
		if (existing[0]) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		if (!leaf) return;
		await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
}
