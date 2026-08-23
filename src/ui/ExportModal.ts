// ui/ExportModal.ts
// Fase 3 — Exportacion CSV (primer adapter).
// Fase 4 — selector de formato de salida (CSV generico / CSV para Toggl).
// Fase 5 — rediseno: "CSV para Toggl" deja de bloquearse en el selector.
// Si el email de Toggl no es valido, el modal muestra un campo editable
// ahi mismo (en vez de derivar a Settings) y lo persiste como el mismo
// ajuste de Settings al exportar — no es un valor "solo para esta
// exportacion".
// Fase 9 — tercer formato "CSV para Clockify": mismo patron de email
// editable in-place que Toggl, mas dos checkboxes propios ("Include
// Project", "Include Client") — ver ClockifyCsvAdapter.ts. Ninguna columna
// es obligatoria para el importador de Clockify (rectificado el 22 de
// agosto de 2026, ver docs/Vault/Tareas/Clockify.md: el hallazgo original
// venia del formulario manual "Add time", no del importador de CSV), asi
// que ambos checkboxes son independientes entre si y arrancan desmarcados.
// Responsabilidad: modal de seleccion de rango de fechas (desde/hasta) y
// formato de exportacion.

import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { t } from "../i18n";
import { ClockifySettings, isValidEmail, TogglSettings } from "../types";

export type ExportFormat = "generic" | "toggl" | "clockify";

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
	// Casilla "Incluir Proyecto y Cliente" (Fase 8): a diferencia del email,
	// no tiene un estado intermedio invalido que proteger, asi que se
	// persiste de inmediato al cambiarla (via saveIncludeProjectClient), no
	// se difiere hasta pulsar "Exportar".
	private includeProjectClientSetting: Setting | null = null;

	// Fase 9 — mismo patron que los tres campos de Toggl de arriba, para
	// Clockify: borrador local de email (no se persiste hasta "Exportar") y
	// casillas "Include Project"/"Include Client" (se persisten al instante,
	// sin estado intermedio invalido). El resto de mensajes informativos de
	// este formato viven agrupados en clockifyInfoEl (ver mas abajo).
	private clockifyEmailDraft: string;
	private clockifyEmailSetting: Setting | null = null;
	private clockifyEmailMessageEl: HTMLElement | null = null;
	private clockifyIncludeProjectSetting: Setting | null = null;
	private clockifyIncludeClientSetting: Setting | null = null;
	// Fase 9 rediseno — tres secciones separadas por linea divisoria, cada
	// una con su propio encabezado: los checkboxes "Include Project"/
	// "Include Client" (ninguno obligatorio, ver rectificacion del 22 de
	// agosto de 2026 en docs/Vault/Tareas/Clockify.md), "Date format" y
	// "Avoid duplicates in Clockify" (ambas notas permanentes, no ligadas al
	// rango elegido). La antigua seccion "Project (required)" con estado
	// dinamico warning/success se elimino: ya no aplica, Project se
	// comporta igual que Client.
	private clockifyInfoEl: HTMLElement | null = null;

	constructor(
		app: App,
		private toggl: TogglSettings,
		private saveTogglEmail: (email: string) => Promise<void>,
		private saveIncludeProjectClient: (value: boolean) => Promise<void>,
		private clockify: ClockifySettings,
		private saveClockifyEmail: (email: string) => Promise<void>,
		private saveClockifyIncludeProject: (value: boolean) => Promise<void>,
		private saveClockifyIncludeClient: (value: boolean) => Promise<void>,
		private onSubmit: (fromValue: string, toValue: string, format: ExportFormat) => void,
	) {
		super(app);
		this.togglEmailDraft = toggl.email;
		this.clockifyEmailDraft = clockify.email;
		const today = new Date();
		const weekAgo = new Date(today);
		weekAgo.setDate(weekAgo.getDate() - 7);
		this.toValue = toDateInputValue(today);
		this.fromValue = toDateInputValue(weekAgo);
	}

	onOpen(): void {
		const { contentEl } = this;
		// Correccion QA — mismo bug que en EditTaskModal.ts: un <h3> propio
		// dentro de contentEl queda en su propia linea, por debajo del boton
		// de cerrar (X) del modal, en vez de alineado con el. Usar el titulo
		// nativo del Modal (this.setTitle(), publico) resuelve el
		// desalineamiento de raiz: Obsidian ya lo posiciona en la misma fila
		// que ese boton dentro de modal-header. Afecta a los tres formatos
		// por igual (el titulo no depende de this.format).
		this.setTitle(t("export.title"));

		new Setting(contentEl).setName(t("export.from")).addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.fromValue);
			text.onChange((value) => (this.fromValue = value));
		});

		new Setting(contentEl).setName(t("export.to")).addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.toValue);
			text.onChange((value) => (this.toValue = value));
		});

		new Setting(contentEl).setName(t("export.formatLabel")).addDropdown((dropdown) => {
			dropdown.addOption("generic", t("export.formatGeneric"));
			dropdown.addOption("toggl", t("export.formatToggl"));
			dropdown.addOption("clockify", t("export.formatClockify"));
			dropdown.setValue(this.format);
			dropdown.onChange((value) => {
				this.format = value as ExportFormat;
				this.updateFormatFields();
			});
		});

		// Visible siempre que el formato sea Toggl, sin importar si el email
		// ya es valido — ver updateFormatFields() sobre por que la
		// visibilidad del campo no puede depender de la validez. El aviso de
		// abajo si reacciona a la validez, reutilizando las mismas clases de
		// mensaje que el formulario de edicion de sesiones del Historial.
		this.emailSetting = new Setting(contentEl).setName(t("export.togglEmailLabel")).addText((text) =>
			text
				.setPlaceholder(t("export.emailPlaceholder"))
				.setValue(this.togglEmailDraft)
				.onChange((value) => {
					this.togglEmailDraft = value.trim();
					this.updateFormatFields();
				}),
		);
		this.emailSetting.settingEl.addClass("task-time-tracker-export-email-setting");
		this.emailMessageEl = contentEl.createEl("p", { cls: "task-time-tracker-log-edit-message" });

		// Fase 8 — opt-in para incluir columnas Project/Client en el CSV de
		// Toggl (la generacion de esas columnas es una tarea posterior). El
		// texto de ayuda va en setDesc(), igual que en SettingsTab.ts — asi el
		// propio layout del Setting (fila info+control de Obsidian) lo coloca
		// debajo de la fila a ancho completo, sin solaparse con el switch.
		this.includeProjectClientSetting = new Setting(contentEl)
			.setName(t("export.includeProjectClientLabel"))
			.setDesc(t("export.includeProjectClientHelp"))
			.addToggle((toggle) =>
				toggle.setValue(this.toggl.includeProjectClient).onChange((value) => {
					this.toggl.includeProjectClient = value;
					void this.saveIncludeProjectClient(value);
				}),
			);
		this.includeProjectClientSetting.settingEl.addClass("task-time-tracker-export-include-project-client-setting");

		// Fase 9 — mismo patron de email editable in-place que Toggl (ver
		// bloque de arriba); visibilidad tambien depende solo del formato,
		// nunca de la validez del email, mismo motivo.
		this.clockifyEmailSetting = new Setting(contentEl).setName(t("export.clockifyEmailLabel")).addText((text) =>
			text
				.setPlaceholder(t("export.emailPlaceholder"))
				.setValue(this.clockifyEmailDraft)
				.onChange((value) => {
					this.clockifyEmailDraft = value.trim();
					this.updateFormatFields();
				}),
		);
		this.clockifyEmailSetting.settingEl.addClass("task-time-tracker-export-clockify-email-setting");
		this.clockifyEmailMessageEl = contentEl.createEl("p", { cls: "task-time-tracker-log-edit-message" });

		// Fase 9 rediseno — tres secciones separadas por linea divisoria en
		// vez de un unico bloque de texto corrido, cada una con su propio
		// encabezado. Visibilidad conjunta (todo el bloque depende solo del
		// formato elegido, ver updateFormatFields()); el contenido de cada
		// seccion individual se explica junto a su creacion mas abajo.
		this.clockifyInfoEl = contentEl.createDiv({ cls: "task-time-tracker-export-clockify-sections" });

		// Seccion 1 — "Include Project" e "Include Client": los dos unicos
		// checkboxes de Clockify, independientes entre si, ninguno obligatorio
		// (rectificado el 22 de agosto de 2026, ver
		// docs/Vault/Tareas/Clockify.md) — mismo comportamiento y mismo
		// espiritu que ambos, asi que comparten seccion sin divisor entre
		// ellos. El nombre de cada Setting hace de encabezado de su propia
		// fila, sin duplicarlo aparte. Misma fuente de verdad que
		// Settings > Clockify.
		const checkboxesSection = this.clockifyInfoEl.createDiv({
			cls: "task-time-tracker-export-clockify-section",
		});
		this.clockifyIncludeProjectSetting = new Setting(checkboxesSection)
			.setName(t("export.includeProjectLabel"))
			.setDesc(t("export.clockifyIncludeProjectHelp"))
			.addToggle((toggle) =>
				toggle.setValue(this.clockify.includeProject).onChange((value) => {
					this.clockify.includeProject = value;
					void this.saveClockifyIncludeProject(value);
				}),
			);
		this.clockifyIncludeClientSetting = new Setting(checkboxesSection)
			.setName(t("export.includeClientLabel"))
			.setDesc(t("export.clockifyIncludeClientHelp"))
			.addToggle((toggle) =>
				toggle.setValue(this.clockify.includeClient).onChange((value) => {
					this.clockify.includeClient = value;
					void this.saveClockifyIncludeClient(value);
				}),
			);

		// Seccion 2 — "Date format": que opcion elegir en el desplegable que
		// Clockify muestra al importar (nuestro CSV genera siempre YYYY-MM-DD).
		// Nota permanente, no ligada al rango elegido.
		const dateFormatSection = this.clockifyInfoEl.createDiv({ cls: "task-time-tracker-export-clockify-section" });
		dateFormatSection.createEl("p", {
			text: t("export.clockifyDateFormatHeading"),
			cls: "task-time-tracker-export-clockify-heading",
		});
		dateFormatSection.createEl("p", {
			text: t("export.clockifyDateFormatNote"),
			cls: "task-time-tracker-export-clockify-note",
		});

		// Seccion 3 — "Avoid duplicates in Clockify": importar sesiones que ya
		// estan en Clockify duplica las entradas, Clockify no fusiona ni
		// avisa. Correccion QA — a diferencia de "Date format" (nota
		// discreta, .task-time-tracker-export-clockify-note), esta es el
		// unico aviso del modal sobre algo que puede fallar de verdad
		// (duplicar horas sin darse cuenta): estilo warning destacado, mismas
		// clases que ya usaba el aviso de sesiones sin proyecto antes de
		// eliminarse esa seccion. Permanente, no ligada al rango elegido.
		const reimportSection = this.clockifyInfoEl.createDiv({ cls: "task-time-tracker-export-clockify-section" });
		reimportSection.createEl("p", {
			text: t("export.clockifyReimportHeading"),
			cls: "task-time-tracker-export-clockify-heading",
		});
		reimportSection.createEl("p", {
			text: t("export.clockifyReimportNote"),
			cls: "task-time-tracker-log-edit-message task-time-tracker-log-edit-message-warning",
		});

		new Setting(contentEl).addButton((button) => {
			this.exportButton = button
				.setButtonText(t("export.exportButton"))
				.setCta()
				.onClick(() => void this.handleSubmit());
		});

		this.updateFormatFields();
	}

	private needsTogglEmail(): boolean {
		return this.format === "toggl" && !isValidEmail(this.togglEmailDraft);
	}

	private needsClockifyEmail(): boolean {
		return this.format === "clockify" && !isValidEmail(this.clockifyEmailDraft);
	}

	// La visibilidad de los campos de cada plataforma depende solo del
	// formato elegido, nunca de la validez de su email: si dependiera de
	// needsTogglEmail()/needsClockifyEmail(), el campo desaparecia a mitad
	// de tecleo en cuanto el valor se volvia valido (p. ej. al perder el
	// foco), justo cuando el usuario recien acababa de escribirlo. Los
	// avisos y el boton "Exportar" si dependen del contenido actual (email
	// tecleado, rango de fechas) — esos son los que deben reaccionar.
	private updateFormatFields(): void {
		const showToggl = this.format === "toggl";
		const showClockify = this.format === "clockify";
		const needsTogglEmail = this.needsTogglEmail();
		const needsClockifyEmail = this.needsClockifyEmail();

		this.emailSetting?.settingEl.toggleClass("is-hidden", !showToggl);
		this.includeProjectClientSetting?.settingEl.toggleClass("is-hidden", !showToggl);

		if (this.emailMessageEl) {
			this.emailMessageEl.toggleClass("is-hidden", !needsTogglEmail);
			this.emailMessageEl.toggleClass("task-time-tracker-log-edit-message-error", needsTogglEmail);
			this.emailMessageEl.setText(
				needsTogglEmail
					? this.togglEmailDraft.length === 0
						? t("export.emailRequired")
						: t("export.emailInvalid")
					: "",
			);
		}

		this.clockifyEmailSetting?.settingEl.toggleClass("is-hidden", !showClockify);
		this.clockifyInfoEl?.toggleClass("is-hidden", !showClockify);

		if (this.clockifyEmailMessageEl) {
			this.clockifyEmailMessageEl.toggleClass("is-hidden", !needsClockifyEmail);
			this.clockifyEmailMessageEl.toggleClass("task-time-tracker-log-edit-message-error", needsClockifyEmail);
			this.clockifyEmailMessageEl.setText(
				needsClockifyEmail
					? this.clockifyEmailDraft.length === 0
						? t("export.clockifyEmailRequired")
						: t("export.emailInvalid")
					: "",
			);
		}

		this.exportButton?.setDisabled(needsTogglEmail || needsClockifyEmail);
	}

	private async handleSubmit(): Promise<void> {
		if (!this.fromValue || !this.toValue) {
			new Notice(t("export.rangeInvalid"));
			return;
		}
		if (this.fromValue > this.toValue) {
			new Notice(t("export.fromAfterTo"));
			return;
		}
		if (this.needsTogglEmail()) {
			new Notice(t("export.emailInvalidNotice"));
			return;
		}
		if (this.needsClockifyEmail()) {
			new Notice(t("export.clockifyEmailInvalidNotice"));
			return;
		}

		// Unica fuente de verdad: si se tecleo un email nuevo en este modal,
		// se persiste como el mismo ajuste de Settings > [Plataforma] > Email
		// antes de exportar, no como un valor exclusivo de esta exportacion.
		if (this.format === "toggl" && this.togglEmailDraft !== this.toggl.email) {
			await this.saveTogglEmail(this.togglEmailDraft);
		}
		if (this.format === "clockify" && this.clockifyEmailDraft !== this.clockify.email) {
			await this.saveClockifyEmail(this.clockifyEmailDraft);
		}

		this.onSubmit(this.fromValue, this.toValue, this.format);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
