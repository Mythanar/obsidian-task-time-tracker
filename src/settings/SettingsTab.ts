// settings/SettingsTab.ts
// Fase 4 — ajustes de Toggl (email, formato de fecha/hora) que necesita
// TogglCsvAdapter.ts. Sin campos de token/credenciales: este adapter no
// llama a ninguna API, solo genera un archivo.
// Fase 5 — sección "General" para ajustes globales del plugin; por ahora
// es un placeholder sin contenido funcional.

import { App, PluginSettingTab, Setting } from "obsidian";
import type TaskTimeTrackerPlugin from "../main";
import { isValidEmail, LogViewLocation, TogglDateFormat, TogglTimeFormat } from "../types";

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
