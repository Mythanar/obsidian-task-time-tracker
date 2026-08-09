import { Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { TrackingEngine } from "./core/TrackingEngine";
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

export default class TaskTimeTrackerPlugin extends Plugin {
	trackingEngine!: TrackingEngine;
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
			},
		};

		this.trackingEngine = new TrackingEngine(this.pluginState, (s) => this.saveData(s));
		this.taskIdentifier = new TaskIdentifier(this.app);
		this.exportManager = new ExportManager(this.app, this.taskIdentifier);
		this.statusBarWidget = new StatusBarWidget(this, () => this.trackingEngine.getActiveEntry());
		this.addSettingTab(new SettingsTab(this.app, this));

		this.registerView(
			TIME_LOG_VIEW_TYPE,
			(leaf) => new TimeLogView(leaf, () => this.trackingEngine.getEntries(), this.taskIdentifier),
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
			name: "Start tracking on current task",
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) =>
				this.startTrackingFromCursor(editor, ctx),
		});

		this.addCommand({
			id: "stop-active-tracking",
			name: "Stop active tracking",
			callback: async () => {
				const stopped = await this.trackingEngine.stop();
				if (!stopped) {
					new Notice("No hay ninguna sesión de tracking activa.");
				}
				this.statusBarWidget.refresh();
				this.refreshLogViews();
				this.notifyTrackingChanged();
			},
		});

		this.addCommand({
			id: "open-time-log-panel",
			name: "Open time log panel",
			callback: () => this.activateLogView(),
		});

		this.addCommand({
			id: "export-time-entries",
			name: "Export time entries...",
			callback: () => {
				new ExportModal(this.app, this.pluginState.settings.toggl.email, (fromValue, toValue, format) => {
					void this.runExport(fromValue, toValue, format);
				}).open();
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

	onunload() {}

	private async startTrackingFromCursor(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): Promise<void> {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const taskText = parseCheckboxLine(line);
		if (taskText === null) {
			new Notice("La línea actual no es una tarea (checkbox).");
			return;
		}

		if (isClosedCheckboxState(extractCheckboxState(line))) {
			new Notice("Esta tarea ya está cerrada; no se puede trackear.");
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
			new Notice("Esta tarea ya se está trackeando.");
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

		try {
			const filePath =
				format === "toggl"
					? await this.exportManager.exportToTogglCsv(
							this.trackingEngine.getEntries(),
							fromMs,
							toMs,
							this.pluginState.settings.toggl,
						)
					: await this.exportManager.exportToCsv(this.trackingEngine.getEntries(), fromMs, toMs);
			new Notice(`Exportado a ${filePath}`);
		} catch (error) {
			console.error("Task Time Tracker: error exportando a CSV", error);
			new Notice("Ocurrió un error al exportar. Revisa la consola para más detalles.");
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.pluginState);
	}

	private refreshLogViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_LOG_VIEW_TYPE)) {
			if (leaf.view instanceof TimeLogView) leaf.view.refresh();
		}
	}

	private async activateLogView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(TIME_LOG_VIEW_TYPE);
		if (existing[0]) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf: WorkspaceLeaf | null = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: TIME_LOG_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
}
