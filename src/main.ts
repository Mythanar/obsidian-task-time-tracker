import { Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { TrackingEngine } from "./core/TrackingEngine";
import { ProjectManager } from "./core/ProjectManager";
import {
	extractCheckboxState,
	extractTaskId,
	appendTaskId,
	generateTaskId,
	isClosedCheckboxState,
	parseCheckboxLine,
	TaskIdentifier,
} from "./core/TaskIdentifier";
import { StatusBarWidget } from "./ui/StatusBarWidget";
import { TimeLogView, TIME_LOG_VIEW_TYPE } from "./ui/TimeLogView";
import { RecoveryModal } from "./ui/RecoveryModal";
import { ExportModal, ExportFormat } from "./ui/ExportModal";
import { ExportManager } from "./export/ExportManager";
import { SettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, PluginState } from "./types";
import { InlineTrackingBus } from "./ui/InlineTrackingBus";
import { createInlineTaskControlExtension } from "./ui/InlineTaskControlExtension";
import { DeleteTaskResult, EntryUpdateResult } from "./types";
import { t } from "./i18n";

/**
 * Task Time Tracker
 *
 * FASE 1 — MVP de tracking local.
 * FASE 2 — vinculacion robusta a tareas via tt-id:: inline.
 * FASE 3 — exportacion manual a CSV.
 * FASE 4 — exportacion CSV para el importador nativo de Toggl.
 * FASE 5 — una tarea cerrada ([x] o [-]) no se puede trackear; si se
 * cierra mientras esta activa, el tracking se detiene solo. Badge
 * play/stop junto al checkbox (solo modo Edicion) para iniciar y
 * detener el tracking sin usar el comando.
 * Local-first: start/stop y persistencia no dependen de red; la
 * exportacion es siempre push manual, nunca sync en tiempo real; ningun
 * adapter de exportacion llama a una API externa.
 */

// Al marcar el checkbox en modo Edicion, Obsidian guarda el cambio a
// disco (y dispara vault.on("modify")) con un debounce de ~2s propio del
// editor. Para no depender de ese retraso, tambien se escucha
// workspace.on("editor-change") leyendo el contenido en vivo del editor;
// este debounce propio (mucho mas corto) evita reaccionar a un estado
// transitorio de la linea mientras el usuario sigue editando.
const EDITOR_CHANGE_DEBOUNCE_MS = 300;

// Fase 7 — ver applyTaskIdFormatClass().
const TASKID_FORMAT_BODY_CLASSES = ["task-time-tracker-taskid-reduced", "task-time-tracker-taskid-hidden"];

export default class TaskTimeTrackerPlugin extends Plugin {
	trackingEngine!: TrackingEngine;
	projectManager!: ProjectManager;
	statusBarWidget!: StatusBarWidget;
	taskIdentifier!: TaskIdentifier;
	exportManager!: ExportManager;
	pluginState!: PluginState;
	private editorChangeDebounceTimer: number | null = null;
	private inlineControlsBus = new InlineTrackingBus();

	async onload() {
		const savedState = (await this.loadData()) as Partial<PluginState> | null;
		this.pluginState = {
			entries: savedState?.entries ?? [],
			settings: {
				toggl: { ...DEFAULT_SETTINGS.toggl, ...savedState?.settings?.toggl },
				logViewLocation: savedState?.settings?.logViewLocation ?? DEFAULT_SETTINGS.logViewLocation,
				exportsFolder: savedState?.settings?.exportsFolder ?? DEFAULT_SETTINGS.exportsFolder,
				taskIdFormat: savedState?.settings?.taskIdFormat ?? DEFAULT_SETTINGS.taskIdFormat,
			},
			projects: savedState?.projects ?? [],
			taskProjects: savedState?.taskProjects ?? {},
		};
		this.applyTaskIdFormatClass();

		this.trackingEngine = new TrackingEngine(this.pluginState, (s) => this.saveData(s));
		this.projectManager = new ProjectManager(this.pluginState, (s) => this.saveData(s));
		this.taskIdentifier = new TaskIdentifier(this.app);
		this.exportManager = new ExportManager(this.app, this.taskIdentifier, this.projectManager);
		this.statusBarWidget = new StatusBarWidget(
			this,
			() => this.trackingEngine.getActiveEntry(),
			() => void this.activateLogView(),
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
					getEntriesForTask: (taskId) => this.trackingEngine.getEntries().filter((e) => e.taskId === taskId),
					getProjects: () => this.projectManager.getProjects(),
					getProjectForTask: (taskId) => this.projectManager.getProjectForTask(taskId),
					assignProject: (taskId, projectId) => this.projectManager.assignProject(taskId, projectId),
					bus: this.inlineControlsBus,
				}),
		);

		// Respaldo: cubre ediciones que no pasan por un editor abierto en
		// Obsidian (edicion externa al vault, sync entre dispositivos, o
		// el propio guardado a disco del editor tras su debounce interno).
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				void this.handleFileModified(file);
			}),
		);

		// Camino rapido: reacciona al contenido en vivo del editor sin
		// esperar al guardado a disco (ver EDITOR_CHANGE_DEBOUNCE_MS).
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

		// Badge play/stop junto al checkbox (Fase 5 UX), solo en modo
		// Edicion (CodeMirror). El tick cada segundo solo se dispara si hay
		// una sesion activa, para no hacer trabajo de balde cuando no hay
		// nada corriendo.
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
				const stopped = await this.trackingEngine.stop();
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
			id: "export-time-entries",
			name: t("cmd.export"),
			callback: () => {
				new ExportModal(
					this.app,
					this.pluginState.settings.toggl,
					(email) => this.saveTogglEmail(email),
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
					void this.trackingEngine.stop().then(() => {
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

		let taskId = extractTaskId(line);
		if (!taskId) {
			taskId = generateTaskId();
			editor.setLine(cursor.line, appendTaskId(line, taskId));
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

	// Respaldo para archivos que no estan abiertos en ningun editor:
	// vault.on("modify") se dispara igual (Obsidian ya escribio el
	// archivo a disco), asi que basta con leerlo del vault.
	private async handleFileModified(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile)) return;
		if (!this.trackingEngine.getActiveEntry()) return;

		const content = await this.app.vault.cachedRead(file);
		await this.stopIfActiveTaskClosedIn(content);
	}

	// Debounce corto: cada tecla reprograma el chequeo, asi que solo se
	// evalua el contenido una vez que el usuario deja de escribir esa
	// linea durante EDITOR_CHANGE_DEBOUNCE_MS. Un estado "[x]"/"[-]"
	// transitorio a mitad de una edicion nunca llega a evaluarse si se
	// corrige antes de que venza el plazo.
	private scheduleEditorChangeCheck(editor: Editor): void {
		if (!this.trackingEngine.getActiveEntry()) return;

		if (this.editorChangeDebounceTimer !== null) {
			window.clearTimeout(this.editorChangeDebounceTimer);
		}
		this.editorChangeDebounceTimer = window.setTimeout(() => {
			this.editorChangeDebounceTimer = null;
			void this.stopIfActiveTaskClosedIn(editor.getValue());
		}, EDITOR_CHANGE_DEBOUNCE_MS);
	}

	// Busca la linea de la sesion activa por su tt-id en el contenido
	// dado (de un editor en vivo o de un archivo leido del vault) y, si
	// su checkbox esta cerrado, detiene el tracking igual que un "Stop
	// tracking" manual.
	private async stopIfActiveTaskClosedIn(content: string): Promise<void> {
		const active = this.trackingEngine.getActiveEntry();
		if (!active) return;

		for (const line of content.split("\n")) {
			if (extractTaskId(line) !== active.taskId) continue;
			if (isClosedCheckboxState(extractCheckboxState(line))) {
				await this.trackingEngine.stop();
				this.statusBarWidget.refresh();
				this.refreshLogViews();
				this.notifyTrackingChanged();
			}
			return;
		}
	}

	// Fase 5 UX — control inline: inicia/detiene el tracking desde el
	// badge play/stop junto al checkbox (modo Edicion). El propio control
	// (InlineTaskControlExtension) ya se aseguro de que la linea tenga
	// tt-id antes de llamar aqui; esta funcion solo mueve el estado del
	// TrackingEngine, igual que el comando.
	private async handleInlineStart(taskId: string, taskText: string, filePath: string): Promise<void> {
		const result = await this.trackingEngine.start(taskId, taskText, filePath);
		if (result !== "started") return;
		this.statusBarWidget.refresh();
		this.refreshLogViews();
		this.notifyTrackingChanged();
	}

	private async handleInlineStop(): Promise<void> {
		const stopped = await this.trackingEngine.stop();
		if (!stopped) return;
		this.statusBarWidget.refresh();
		this.refreshLogViews();
		this.notifyTrackingChanged();
	}

	// Avisa a los controles inline ya montados (icono junto al checkbox)
	// de que el estado de tracking cambio, para que actualicen icono/badge
	// sin esperar al tick de 1s. No hace falta forzar una reconstruccion de
	// decoraciones en CodeMirror: cada widget ya montado esta suscrito a
	// este bus y se redibuja solo (ver InlineTaskControlExtension.ts).
	private notifyTrackingChanged(): void {
		this.inlineControlsBus.notify();
	}

	private async runExport(fromValue: string, toValue: string, format: ExportFormat): Promise<void> {
		const fromMs = new Date(`${fromValue}T00:00:00`).getTime();
		const toMs = new Date(`${toValue}T23:59:59.999`).getTime();
		const exportsFolder = this.pluginState.settings.exportsFolder;

		try {
			const filePath =
				format === "toggl"
					? await this.exportManager.exportToTogglCsv(
							this.trackingEngine.getEntries(),
							fromMs,
							toMs,
							this.pluginState.settings.toggl,
							exportsFolder,
						)
					: await this.exportManager.exportToCsv(this.trackingEngine.getEntries(), fromMs, toMs, exportsFolder);
			new Notice(t("notice.exportSuccess", { filePath }));
		} catch (error) {
			console.error("Task Time Tracker: error exportando a CSV", error);
			new Notice(t("notice.exportError"));
		}
	}

	// Fase 5 — boton "Exportar todo" en Settings: salvaguarda ante una
	// desinstalacion, ya que la API de Obsidian no permite interceptar el
	// momento exacto en que el usuario desinstala un plugin (no hay forma
	// tecnica de avisar "justo antes"). Mismo camino que runExport() con
	// formato CSV generico y el rango completo precalculado (desde la
	// primera sesion hasta ahora) — sin modal, sin seleccion de rango ni
	// de formato, un solo clic. La sesion activa (si hay una) queda fuera
	// igual que en cualquier otra exportacion: exportToCsv() ya filtra por
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

	// Fase 5 — el modal de exportacion permite completar el email de Toggl
	// ahi mismo si falta; al confirmar, se persiste aqui como el mismo
	// ajuste de Settings > Toggl > Email (unica fuente de verdad), nunca
	// como un valor exclusivo de esa exportacion.
	private async saveTogglEmail(email: string): Promise<void> {
		this.pluginState.settings.toggl.email = email;
		await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.pluginState);
	}

	// Fase 5 UX — panel de Historial: edicion inline de inicio/fin de una
	// sesion ya cerrada. Se opera directamente sobre pluginState.entries
	// (el mismo array que ya usa TrackingEngine, pasado por referencia) en
	// vez de agregar metodos a TrackingEngine — su responsabilidad sigue
	// siendo solo el timer activo. El aviso de solapamiento con otra
	// sesion se calcula en vivo del lado de TimeLogView mientras se
	// edita, no aqui — el guardado nunca se bloquea por eso.
	async updateEntryTimes(entryId: string, start: number, end: number): Promise<EntryUpdateResult> {
		const entries = this.trackingEngine.getEntries();
		const entry = entries.find((e) => e.id === entryId);
		if (!entry || entry.end === null) return { ok: false, error: "not-found" };
		if (end <= start) return { ok: false, error: "invalid-range" };

		entry.start = start;
		entry.end = end;
		await this.saveData(this.pluginState);

		this.refreshLogViews();
		this.notifyTrackingChanged();
		return { ok: true };
	}

	// Fase 5 UX — panel de Historial: borrado definitivo de una sesion
	// cerrada (la confirmacion vive en la UI, aqui ya se asume confirmado).
	async deleteEntry(entryId: string): Promise<void> {
		const entries = this.trackingEngine.getEntries();
		const index = entries.findIndex((e) => e.id === entryId);
		if (index === -1) return;

		entries.splice(index, 1);
		await this.saveData(this.pluginState);
		this.refreshLogViews();
		this.notifyTrackingChanged();
	}

	// Fase 5 UX — panel de Historial: borrado de una tarea completa, todo
	// su historico por tt-id (incluidas sesiones de otras notas si el id
	// esta duplicado — mismo criterio de Fase 2 de tratar duplicados como
	// la misma tarea). Nunca toca la nota: el [tt-id:: ...] que quede en
	// la linea de la tarea se deja intacto y huerfano a proposito; si el
	// usuario vuelve a trackear esa linea, simplemente arranca un
	// historico nuevo bajo el mismo id. Bloqueado mientras esa tarea
	// tenga la sesion activa (la confirmacion vive en la UI, aqui ya se
	// asume confirmado salvo por este bloqueo).
	async deleteTask(taskId: string): Promise<DeleteTaskResult> {
		const active = this.trackingEngine.getActiveEntry();
		if (active?.taskId === taskId) return { ok: false, error: "active" };

		const entries = this.trackingEngine.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			if (entries[i]?.taskId === taskId) entries.splice(i, 1);
		}
		await this.saveData(this.pluginState);
		this.refreshLogViews();
		this.notifyTrackingChanged();
		return { ok: true };
	}

	// Publico: tambien lo llama ProjectsSection.ts (via SettingsTab.ts) tras
	// borrar un proyecto, para que las tarjetas del Historial que lo tenian
	// asignado pierdan la fila de Proyecto/Cliente sin esperar a un refresco
	// externo del panel.
	refreshLogViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_LOG_VIEW_TYPE)) {
			if (leaf.view instanceof TimeLogView) leaf.view.refresh();
		}
	}

	// Bloque 2 — la ubicacion (sidebar/tab) solo se decide al crear un leaf
	// nuevo; un panel ya abierto se revela donde ya estaba, sin moverlo (ver
	// SettingsTab.ts).
	private async activateLogView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(TIME_LOG_VIEW_TYPE);
		if (existing[0]) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf: WorkspaceLeaf | null =
			this.pluginState.settings.logViewLocation === "tab"
				? this.app.workspace.getLeaf("tab")
				: this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: TIME_LOG_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
}
