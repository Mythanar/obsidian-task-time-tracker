// ui/ExportModal.ts
// Fase 3 — Exportacion CSV (primer adapter).
// Fase 4 — selector de formato de salida (CSV generico / CSV para Toggl).
// Responsabilidad: modal de seleccion de rango de fechas (desde/hasta) y
// formato de exportacion.

import { App, Modal, Notice, Setting } from "obsidian";
import { isValidEmail } from "../types";

export type ExportFormat = "generic" | "toggl";

function toDateInputValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class ExportModal extends Modal {
	private fromValue: string;
	private toValue: string;
	private format: ExportFormat = "generic";
	private readonly togglAvailable: boolean;

	constructor(
		app: App,
		togglEmail: string,
		private onSubmit: (fromValue: string, toValue: string, format: ExportFormat) => void,
	) {
		super(app);
		this.togglAvailable = isValidEmail(togglEmail);
		const today = new Date();
		const weekAgo = new Date(today);
		weekAgo.setDate(weekAgo.getDate() - 7);
		this.toValue = toDateInputValue(today);
		this.fromValue = toDateInputValue(weekAgo);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Exportar sesiones" });

		new Setting(contentEl).setName("Desde").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.fromValue);
			text.onChange((value) => (this.fromValue = value));
		});

		new Setting(contentEl).setName("Hasta").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.toValue);
			text.onChange((value) => (this.toValue = value));
		});

		const formatSetting = new Setting(contentEl).setName("Formato").addDropdown((dropdown) => {
			dropdown.addOption("generic", "CSV genérico");
			dropdown.addOption("toggl", "CSV para Toggl");
			dropdown.setValue(this.format);
			dropdown.onChange((value) => (this.format = value as ExportFormat));

			if (!this.togglAvailable) {
				const togglOption = dropdown.selectEl.querySelector('option[value="toggl"]');
				if (togglOption instanceof HTMLOptionElement) togglOption.disabled = true;
			}
		});

		if (!this.togglAvailable) {
			formatSetting.setDesc(
				"Para exportar a Toggl, completa el email de tu cuenta en Ajustes → Task Time Tracker → Toggl.",
			);
		}

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText("Exportar")
				.setCta()
				.onClick(() => {
					if (!this.fromValue || !this.toValue) {
						new Notice("Selecciona un rango de fechas válido.");
						return;
					}
					if (this.fromValue > this.toValue) {
						new Notice('El campo "Desde" no puede ser posterior a "Hasta".');
						return;
					}
					if (this.format === "toggl" && !this.togglAvailable) {
						new Notice("Completa el email de Toggl en Ajustes antes de exportar con este formato.");
						return;
					}
					this.onSubmit(this.fromValue, this.toValue, this.format);
					this.close();
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
