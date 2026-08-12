// settings/SettingsTab.ts
// Fase 4 — ajustes de Toggl (email, formato de fecha/hora) que necesita
// TogglCsvAdapter.ts. Sin campos de token/credenciales: este adapter no
// llama a ninguna API, solo genera un archivo.
// Fase 5 — sección "General" para ajustes globales del plugin; por ahora
// es un placeholder sin contenido funcional.

import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder } from "obsidian";
import type TaskTimeTrackerPlugin from "../main";
import { t } from "../i18n";
import { DEFAULT_SETTINGS, isValidEmail, LogViewLocation, TaskIdFormat, TogglDateFormat, TogglTimeFormat } from "../types";

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

function dateFormatOptions(): Record<string, string> {
	return {
		ISO: t("settings.toggl.dateFormat.iso"),
		"DD-MM-YYYY": t("settings.toggl.dateFormat.dmy"),
		"MM-DD-YYYY": t("settings.toggl.dateFormat.mdy"),
	};
}

function timeFormatOptions(): Record<string, string> {
	return {
		"24h": t("settings.toggl.timeFormat.24h"),
		"12h": t("settings.toggl.timeFormat.12h"),
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Seccion general (Fase 5): sin encabezado propio a proposito, sigue
		// la convencion de Obsidian de dejar la primera seccion sin titulo.
		// Bloque 2 — ubicacion del panel de Historial: cambiar esto no mueve
		// un panel ya abierto, solo aplica la proxima vez que se abra (ver
		// activateLogView() en main.ts).
		new Setting(containerEl)
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

		// Fase 7 — como se ve el inline field tt-id:: cuando Dataview lo
		// renderiza (Reading mode / Live Preview sin el cursor en la linea).
		// Puramente visual (clase en document.body, ver
		// applyTaskIdFormatClass() en main.ts); no tiene ningun efecto sin
		// Dataview instalado (Obsidian no genera los atributos data-dv-key
		// que el CSS necesita) y no afecta a otros inline fields del
		// usuario ni a las queries de Dataview sobre tt-id.
		new Setting(containerEl)
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

		// Fase 5 — carpeta de destino de ambos formatos de exportacion (CSV
		// generico y CSV para Toggl). Cambiar esto no mueve exportaciones ya
		// hechas en la carpeta anterior, solo aplica desde la proxima
		// exportacion (ver ExportManager.ts).
		new Setting(containerEl)
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

		// Fase 5 — se origino como salvaguarda ante una desinstalacion (la
		// API de Obsidian no permite interceptar ese momento exacto), pero
		// el texto visible no menciona desinstalar: Obsidian preserva
		// data.json por defecto al desinstalar un plugin (decision ya
		// cerrada en Fase 1), asi que ese aviso seria inexacto. Se presenta
		// como buena practica general en vez de advertencia sobre un caso
		// concreto. Un solo clic, sin modal: CSV generico (nunca Toggl),
		// rango completo desde la primera sesion hasta ahora, misma carpeta
		// configurada arriba (ver exportAllEntriesToCsv() en main.ts).
		new Setting(containerEl)
			.setName(t("settings.exportAll.name"))
			.setDesc(t("settings.exportAll.desc"))
			.addButton((button) =>
				button.setButtonText(t("settings.exportAll.button")).onClick(() => void this.plugin.exportAllEntriesToCsv()),
			);

		new Setting(containerEl).setName(t("settings.toggl.heading")).setHeading();

		const { toggl } = this.plugin.pluginState.settings;

		const emailSetting = new Setting(containerEl).setName(t("settings.toggl.email.name"));

		const renderEmailStatus = () => {
			const invalid = toggl.email.length > 0 && !isValidEmail(toggl.email);
			emailSetting.setDesc(invalid ? t("export.emailInvalid") : t("settings.toggl.email.descValid"));
			emailSetting.descEl.toggleClass("task-time-tracker-settings-error", invalid);
		};

		emailSetting.addText((text) =>
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

		new Setting(containerEl).setName(t("settings.toggl.dateFormat.name")).addDropdown((dropdown) => {
			dropdown.addOptions(dateFormatOptions());
			dropdown.setValue(toggl.dateFormat);
			dropdown.onChange(async (value) => {
				toggl.dateFormat = value as TogglDateFormat;
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl).setName(t("settings.toggl.timeFormat.name")).addDropdown((dropdown) => {
			dropdown.addOptions(timeFormatOptions());
			dropdown.setValue(toggl.timeFormat);
			dropdown.onChange(async (value) => {
				toggl.timeFormat = value as TogglTimeFormat;
				await this.plugin.saveSettings();
			});
		});
	}
}
