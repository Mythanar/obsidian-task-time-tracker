// settings/SettingsTab.ts
// Fase 4 — ajustes de Toggl (email, formato de fecha/hora) que necesita
// TogglCsvAdapter.ts. Sin campos de token/credenciales: este adapter no
// llama a ninguna API, solo genera un archivo.
// Fase 5 — sección "General" para ajustes globales del plugin; por ahora
// es un placeholder sin contenido funcional.

import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder } from "obsidian";
import type TaskTimeTrackerPlugin from "../main";
import { DEFAULT_SETTINGS, isValidEmail, LogViewLocation, TogglDateFormat, TogglTimeFormat } from "../types";

const EMAIL_DESC_DEFAULT = "Necesario para exportar sesiones en formato CSV para Toggl.";
const EMAIL_DESC_INVALID = "Ese email no tiene un formato válido (ej. usuario@dominio.com).";

const LOG_VIEW_LOCATION_OPTIONS: Record<string, string> = {
	sidebar: "Panel lateral",
	tab: "Pestaña central",
};

const DATE_FORMAT_OPTIONS: Record<string, string> = {
	ISO: "ISO (AAAA-MM-DD)",
	"DD-MM-YYYY": "DD-MM-AAAA",
	"MM-DD-YYYY": "MM-DD-AAAA",
};

const TIME_FORMAT_OPTIONS: Record<string, string> = {
	"24h": "24 horas",
	"12h": "12 horas (AM/PM)",
};

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
			.setName("Ubicación del Historial")
			.setDesc("Dónde se abre el panel de Historial. Si ya está abierto, el cambio se aplica la próxima vez que lo abras.")
			.addDropdown((dropdown) => {
				dropdown.addOptions(LOG_VIEW_LOCATION_OPTIONS);
				dropdown.setValue(this.plugin.pluginState.settings.logViewLocation);
				dropdown.onChange(async (value) => {
					this.plugin.pluginState.settings.logViewLocation = value as LogViewLocation;
					await this.plugin.saveSettings();
				});
			});

		// Fase 5 — carpeta de destino de ambos formatos de exportacion (CSV
		// generico y CSV para Toggl). Cambiar esto no mueve exportaciones ya
		// hechas en la carpeta anterior, solo aplica desde la proxima
		// exportacion (ver ExportManager.ts).
		new Setting(containerEl)
			.setName("Carpeta de exportación")
			.setDesc(
				"Carpeta dentro de la vault donde se guardan los archivos exportados. Se crea automáticamente si no existe todavía.",
			)
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
			.setName("Exportar todo")
			.setDesc("Tu historial vive solo en este dispositivo. Usa este botón para tener una copia de seguridad en cualquier momento.")
			.addButton((button) =>
				button.setButtonText("Exportar todo").onClick(() => void this.plugin.exportAllEntriesToCsv()),
			);

		new Setting(containerEl).setName("Toggl").setHeading();

		const { toggl } = this.plugin.pluginState.settings;

		const emailSetting = new Setting(containerEl).setName("Email de Toggl");

		const renderEmailStatus = () => {
			const invalid = toggl.email.length > 0 && !isValidEmail(toggl.email);
			emailSetting.setDesc(invalid ? EMAIL_DESC_INVALID : EMAIL_DESC_DEFAULT);
			emailSetting.descEl.toggleClass("task-time-tracker-settings-error", invalid);
		};

		emailSetting.addText((text) =>
			text
				.setPlaceholder("tu@email.com")
				.setValue(toggl.email)
				.onChange(async (value) => {
					toggl.email = value.trim();
					renderEmailStatus();
					await this.plugin.saveSettings();
				}),
		);

		renderEmailStatus();

		new Setting(containerEl).setName("Formato de fecha").addDropdown((dropdown) => {
			dropdown.addOptions(DATE_FORMAT_OPTIONS);
			dropdown.setValue(toggl.dateFormat);
			dropdown.onChange(async (value) => {
				toggl.dateFormat = value as TogglDateFormat;
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl).setName("Formato de hora").addDropdown((dropdown) => {
			dropdown.addOptions(TIME_FORMAT_OPTIONS);
			dropdown.setValue(toggl.timeFormat);
			dropdown.onChange(async (value) => {
				toggl.timeFormat = value as TogglTimeFormat;
				await this.plugin.saveSettings();
			});
		});
	}
}
