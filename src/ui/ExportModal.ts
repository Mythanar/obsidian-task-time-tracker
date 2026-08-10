// ui/ExportModal.ts
// Fase 3 — Exportacion CSV (primer adapter).
// Fase 4 — selector de formato de salida (CSV generico / CSV para Toggl).
// Fase 5 — rediseno: "CSV para Toggl" deja de bloquearse en el selector.
// Si el email de Toggl no es valido, el modal muestra un campo editable
// ahi mismo (en vez de derivar a Settings) y lo persiste como el mismo
// ajuste de Settings al exportar — no es un valor "solo para esta
// exportacion".
// Responsabilidad: modal de seleccion de rango de fechas (desde/hasta) y
// formato de exportacion.

import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { isValidEmail, TogglSettings } from "../types";

export type ExportFormat = "generic" | "toggl";

function toDateInputValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class ExportModal extends Modal {
	private fromValue: string;
	private toValue: string;
	private format: ExportFormat = "generic";
	// Borrador local del email de Toggl: arranca con el valor ya guardado
	// en Settings, pero no se escribe ahi hasta confirmar la exportacion
	// (ver onSubmit del boton "Exportar") — asi un valor a medio escribir
	// nunca contamina el ajuste real si el usuario cierra el modal sin
	// exportar.
	private togglEmailDraft: string;
	private emailSetting: Setting | null = null;
	private emailMessageEl: HTMLElement | null = null;
	private exportButton: ButtonComponent | null = null;

	constructor(
		app: App,
		private toggl: TogglSettings,
		private saveTogglEmail: (email: string) => Promise<void>,
		private onSubmit: (fromValue: string, toValue: string, format: ExportFormat) => void,
	) {
		super(app);
		this.togglEmailDraft = toggl.email;
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

		new Setting(contentEl).setName("Formato").addDropdown((dropdown) => {
			dropdown.addOption("generic", "CSV genérico");
			dropdown.addOption("toggl", "CSV para Toggl");
			dropdown.setValue(this.format);
			dropdown.onChange((value) => {
				this.format = value as ExportFormat;
				this.updateTogglEmailField();
			});
		});

		// Visible siempre que el formato sea Toggl, sin importar si el email
		// ya es valido — ver updateTogglEmailField() sobre por que la
		// visibilidad del campo no puede depender de la validez. El aviso de
		// abajo si reacciona a la validez, reutilizando las mismas clases de
		// mensaje que el formulario de edicion de sesiones del Historial.
		this.emailSetting = new Setting(contentEl).setName("Email de Toggl").addText((text) =>
			text
				.setPlaceholder("tu@email.com")
				.setValue(this.togglEmailDraft)
				.onChange((value) => {
					this.togglEmailDraft = value.trim();
					this.updateTogglEmailField();
				}),
		);
		this.emailSetting.settingEl.addClass("task-time-tracker-export-email-setting");
		this.emailMessageEl = contentEl.createEl("p", { cls: "task-time-tracker-log-edit-message" });

		new Setting(contentEl).addButton((button) => {
			this.exportButton = button
				.setButtonText("Exportar")
				.setCta()
				.onClick(() => void this.handleSubmit());
		});

		this.updateTogglEmailField();
	}

	private needsTogglEmail(): boolean {
		return this.format === "toggl" && !isValidEmail(this.togglEmailDraft);
	}

	// La visibilidad del campo depende solo del formato, nunca de la
	// validez del email: si dependiera de needsTogglEmail(), el campo
	// desaparecia a mitad de tecleo en cuanto el valor se volvia valido
	// (p. ej. al perder el foco), justo cuando el usuario recien acababa
	// de escribirlo. El aviso y el boton "Exportar" si dependen de la
	// validez — esos son los que deben reaccionar al contenido del campo.
	private updateTogglEmailField(): void {
		const showField = this.format === "toggl";
		const needsEmail = this.needsTogglEmail();
		this.emailSetting?.settingEl.toggleClass("is-hidden", !showField);

		if (this.emailMessageEl) {
			this.emailMessageEl.toggleClass("is-hidden", !needsEmail);
			this.emailMessageEl.toggleClass("task-time-tracker-log-edit-message-error", needsEmail);
			this.emailMessageEl.setText(
				needsEmail
					? this.togglEmailDraft.length === 0
						? "El email de Toggl es obligatorio para exportar en este formato."
						: "Ese email no tiene un formato válido (ej. usuario@dominio.com)."
					: "",
			);
		}

		this.exportButton?.setDisabled(needsEmail);
	}

	private async handleSubmit(): Promise<void> {
		if (!this.fromValue || !this.toValue) {
			new Notice("Selecciona un rango de fechas válido.");
			return;
		}
		if (this.fromValue > this.toValue) {
			new Notice('El campo "Desde" no puede ser posterior a "Hasta".');
			return;
		}
		if (this.needsTogglEmail()) {
			new Notice("Completa un email de Toggl válido antes de exportar con este formato.");
			return;
		}

		// Unica fuente de verdad: si se tecleo un email nuevo en este modal,
		// se persiste como el mismo ajuste de Settings > Toggl > Email antes
		// de exportar, no como un valor exclusivo de esta exportacion.
		if (this.format === "toggl" && this.togglEmailDraft !== this.toggl.email) {
			await this.saveTogglEmail(this.togglEmailDraft);
		}

		this.onSubmit(this.fromValue, this.toValue, this.format);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
