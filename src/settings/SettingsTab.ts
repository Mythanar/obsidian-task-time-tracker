// settings/SettingsTab.ts
// Fase 4 — ajustes de Toggl (email) que necesita TogglCsvAdapter.ts. Sin
// campos de token/credenciales: este adapter no llama a ninguna API, solo
// genera un archivo.
// Fase 5 — sección "General" para ajustes globales del plugin; por ahora
// es un placeholder sin contenido funcional.
// Fix urgente pre-release — se eliminaron los selectores de formato de
// fecha/hora de Toggl: el importador real exige un formato fijo, no
// admite el que el usuario eligiera aqui (ver TogglCsvAdapter.ts).
// Post-release — getSettingDefinitions() añade la vista declarativa que
// Obsidian >=1.13 usa para el buscador global de Ajustes. Cada ajuste vive
// en un metodo configureX(setting) que display() y getSettingDefinitions()
// llaman por igual: misma logica, dos vistas. display() sigue intacto como
// fallback para Obsidian <1.13 (esa version no conoce getSettingDefinitions
// y sigue llamando a display() como siempre); no se sube minAppVersion.

import {
	AbstractInputSuggest,
	App,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	TFolder,
} from "obsidian";
import type TaskTimeTrackerPlugin from "../main";
import { t } from "../i18n";
import { DEFAULT_SETTINGS, isValidEmail, LogViewLocation, TaskIdFormat } from "../types";
import { ProjectsSection, renderProjectsBanner } from "./ProjectsSection";

function logViewLocationOptions(): Record<string, string> {
	return {
		sidebar: t("settings.logLocation.sidebar"),
		tab: t("settings.logLocation.tab"),
	};
}

function taskIdFormatOptions(): Record<string, string> {
	return {
		normal: t("settings.taskIdFormat.normal"),
		reduced: t("settings.taskIdFormat.reduced"),
		hidden: t("settings.taskIdFormat.hidden"),
	};
}

// Fase 5 — autocompletado de carpetas ya existentes en la vault para el
// ajuste de carpeta de exportacion, mismo patron de UI que usa Obsidian
// para configurar la carpeta de adjuntos por defecto. Permite escribir
// una ruta que todavia no existe (ExportManager.ts la autocrea al
// exportar) — el autocompletado es solo una ayuda, no una restriccion.
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private onChoose: (path: string) => void,
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault.getAllFolders(true).filter((folder) => folder.path.toLowerCase().includes(q));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.onChoose(folder.path);
		this.close();
	}
}

export class SettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: TaskTimeTrackerPlugin,
	) {
		super(app, plugin);
	}

	// Bloque 2 — ubicacion del panel de Historial: cambiar esto no mueve un
	// panel ya abierto, solo aplica la proxima vez que se abra (ver
	// activateLogView() en main.ts).
	private configureLogLocation(setting: Setting): void {
		setting
			.setName(t("settings.logLocation.name"))
			.setDesc(t("settings.logLocation.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOptions(logViewLocationOptions());
				dropdown.setValue(this.plugin.pluginState.settings.logViewLocation);
				dropdown.onChange(async (value) => {
					this.plugin.pluginState.settings.logViewLocation = value as LogViewLocation;
					await this.plugin.saveSettings();
				});
			});
	}

	// Fase 7 — como se ve el inline field tt-id:: cuando Dataview lo
	// renderiza (Reading mode / Live Preview sin el cursor en la linea).
	// Puramente visual (clase en document.body, ver
	// applyTaskIdFormatClass() en main.ts); no tiene ningun efecto sin
	// Dataview instalado (Obsidian no genera los atributos data-dv-key
	// que el CSS necesita) y no afecta a otros inline fields del
	// usuario ni a las queries de Dataview sobre tt-id.
	private configureTaskIdFormat(setting: Setting): void {
		setting
			.setName(t("settings.taskIdFormat.name"))
			.setDesc(t("settings.taskIdFormat.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOptions(taskIdFormatOptions());
				dropdown.setValue(this.plugin.pluginState.settings.taskIdFormat);
				dropdown.onChange(async (value) => {
					this.plugin.pluginState.settings.taskIdFormat = value as TaskIdFormat;
					this.plugin.applyTaskIdFormatClass();
					await this.plugin.saveSettings();
				});
			});
	}

	// Fase 5 — carpeta de destino de ambos formatos de exportacion (CSV
	// generico y CSV para Toggl). Cambiar esto no mueve exportaciones ya
	// hechas en la carpeta anterior, solo aplica desde la proxima
	// exportacion (ver ExportManager.ts).
	private configureExportFolder(setting: Setting): void {
		setting
			.setName(t("settings.exportFolder.name"))
			.setDesc(t("settings.exportFolder.desc"))
			.addText((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.exportsFolder).setValue(this.plugin.pluginState.settings.exportsFolder);

				const saveExportsFolder = async (path: string) => {
					this.plugin.pluginState.settings.exportsFolder = path.trim();
					await this.plugin.saveSettings();
				};

				new FolderSuggest(this.app, text.inputEl, (path) => void saveExportsFolder(path));
				text.onChange((value) => void saveExportsFolder(value));
			});
	}

	// Fase 5 — se origino como salvaguarda ante una desinstalacion (la
	// API de Obsidian no permite interceptar ese momento exacto), pero
	// el texto visible no menciona desinstalar: Obsidian preserva
	// data.json por defecto al desinstalar un plugin (decision ya
	// cerrada en Fase 1), asi que ese aviso seria inexacto. Se presenta
	// como buena practica general en vez de advertencia sobre un caso
	// concreto. Un solo clic, sin modal: CSV generico (nunca Toggl),
	// rango completo desde la primera sesion hasta ahora, misma carpeta
	// configurada arriba (ver exportAllEntriesToCsv() en main.ts).
	private configureExportAll(setting: Setting): void {
		setting
			.setName(t("settings.exportAll.name"))
			.setDesc(t("settings.exportAll.desc"))
			.addButton((button) =>
				button.setButtonText(t("settings.exportAll.button")).onClick(() => void this.plugin.exportAllEntriesToCsv()),
			);
	}

	// Fase 8 — proyectos/clientes: base para futuros adapters de
	// exportacion (Clockify y otros esperan columnas Project/Client en
	// su importador). Componente autocontenido, ver ProjectsSection.ts.
	private renderProjectsSection(containerEl: HTMLElement): void {
		new ProjectsSection(containerEl.createDiv(), this.plugin.projectManager, () => this.plugin.refreshLogViews()).render();
	}

	// Post-release — una fila `render` de getSettingDefinitions() sigue
	// siendo un Setting con su columna de nombre/descripcion y su columna
	// de control lado a lado (layout de dos columnas). El banner y el
	// bloque de "Projects & clients" (tabs, formulario, lista) necesitan
	// todo el ancho de la fila, no una columna — de ahi que se vacie el
	// settingEl y se fuerce layout de bloque (ver
	// .task-time-tracker-settings-fullwidth-row en styles.css) antes de
	// pintar contenido propio dentro. Solo aplica a la vista declarativa;
	// display() nunca crea un Setting para este contenido.
	private makeFullWidthRow(setting: Setting): HTMLElement {
		setting.settingEl.empty();
		setting.settingEl.addClass("task-time-tracker-settings-fullwidth-row");
		return setting.settingEl.createDiv();
	}

	private renderProjectsBannerRow(setting: Setting): void {
		renderProjectsBanner(this.makeFullWidthRow(setting));
	}

	// includeBanner=false: el banner ya se pinta en su propia fila (ver
	// renderProjectsBannerRow) — evita que reaparezca aqui debajo cada vez
	// que ProjectsSection se re-renderiza a si misma tras una interaccion
	// (agregar/editar/borrar), ya que ese re-render vuelve a llamar a su
	// propio render() completo.
	private renderProjectsContentRow(setting: Setting): void {
		new ProjectsSection(
			this.makeFullWidthRow(setting),
			this.plugin.projectManager,
			() => this.plugin.refreshLogViews(),
			false,
		).render();
	}

	private configureTogglEmail(setting: Setting): void {
		const { toggl } = this.plugin.pluginState.settings;

		setting.setName(t("settings.toggl.email.name"));

		const renderEmailStatus = () => {
			const invalid = toggl.email.length > 0 && !isValidEmail(toggl.email);
			setting.setDesc(invalid ? t("export.emailInvalid") : t("settings.toggl.email.descValid"));
			setting.descEl.toggleClass("task-time-tracker-settings-error", invalid);
		};

		setting.addText((text) =>
			text
				.setPlaceholder(t("settings.toggl.email.placeholder"))
				.setValue(toggl.email)
				.onChange(async (value) => {
					toggl.email = value.trim();
					renderEmailStatus();
					await this.plugin.saveSettings();
				}),
		);

		renderEmailStatus();
	}

	// Fase 8 — opt-in para incluir columnas Project/Client en el CSV de
	// Toggl (la generacion de esas columnas es una tarea posterior,
	// bloqueada por este ajuste). Misma fuente de verdad que la casilla
	// del modal de exportacion (ver ExportModal.ts): cambiarla aqui se
	// refleja alli y viceversa.
	private configureTogglIncludeProjectClient(setting: Setting): void {
		const { toggl } = this.plugin.pluginState.settings;

		setting
			.setName(t("settings.toggl.includeProjectClient.name"))
			.setDesc(t("settings.toggl.includeProjectClient.desc"))
			.addToggle((toggle) =>
				toggle.setValue(toggl.includeProjectClient).onChange(async (value) => {
					toggl.includeProjectClient = value;
					await this.plugin.saveSettings();
				}),
			);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Seccion general (Fase 5): sin encabezado propio a proposito, sigue
		// la convencion de Obsidian de dejar la primera seccion sin titulo.
		this.configureLogLocation(new Setting(containerEl));
		this.configureTaskIdFormat(new Setting(containerEl));
		this.configureExportFolder(new Setting(containerEl));
		this.configureExportAll(new Setting(containerEl));

		new Setting(containerEl).setName(t("settings.projects.heading")).setHeading();
		this.renderProjectsSection(containerEl);

		new Setting(containerEl).setName(t("settings.toggl.heading")).setHeading();
		this.configureTogglEmail(new Setting(containerEl));
		this.configureTogglIncludeProjectClient(new Setting(containerEl));
	}

	// Vista declarativa (Obsidian >=1.13): mismos ajustes que display(),
	// reutilizando los mismos metodos configureX/renderX — no hay una
	// segunda implementacion de la logica de ningun ajuste, solo un
	// segundo punto de entrada que el buscador global de Ajustes indexa.
	// Obsidian <1.13 no conoce este metodo y sigue usando display() tal
	// cual (ver comentario en display()).
	// 3 bloques (SettingDefinitionGroup, heading opcional), mismo patron
	// visual "tarjeta con esquinas redondeadas + separador fino entre
	// filas" que usa Obsidian de forma nativa en pantallas como Settings >
	// Advanced.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				items: [
					{
						name: t("settings.logLocation.name"),
						desc: t("settings.logLocation.desc"),
						render: (setting) => this.configureLogLocation(setting),
					},
					{
						name: t("settings.taskIdFormat.name"),
						desc: t("settings.taskIdFormat.desc"),
						render: (setting) => this.configureTaskIdFormat(setting),
					},
					{
						name: t("settings.exportFolder.name"),
						desc: t("settings.exportFolder.desc"),
						render: (setting) => this.configureExportFolder(setting),
					},
					{
						name: t("settings.exportAll.name"),
						desc: t("settings.exportAll.desc"),
						render: (setting) => this.configureExportAll(setting),
					},
				],
			},
			{
				type: "group",
				heading: t("settings.projects.heading"),
				items: [
					{
						name: t("settings.projects.heading"),
						searchable: false,
						render: (setting) => this.renderProjectsBannerRow(setting),
					},
					{
						name: t("settings.projects.heading"),
						searchable: false,
						render: (setting) => this.renderProjectsContentRow(setting),
					},
				],
			},
			{
				type: "group",
				heading: t("settings.toggl.heading"),
				items: [
					{
						name: t("settings.toggl.email.name"),
						render: (setting) => this.configureTogglEmail(setting),
					},
					{
						name: t("settings.toggl.includeProjectClient.name"),
						desc: t("settings.toggl.includeProjectClient.desc"),
						render: (setting) => this.configureTogglIncludeProjectClient(setting),
					},
				],
			},
		];
	}
}
