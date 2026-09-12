// ui/ExportModal.ts
// Responsibility: modal for selecting the date range (from/to) and
// export format.
//
// "CSV for Toggl" is never blocked in the format selector. If the Toggl
// email isn't valid, the modal shows an editable field right there
// (instead of sending the user to Settings) and persists it as the same
// Settings value on export — it's never a value "just for this export".
// The third format, "CSV for Clockify", follows the same in-place
// editable email pattern as Toggl, plus its own two checkboxes ("Include
// Project", "Include Client") — see ClockifyCsvAdapter.ts. No column is
// actually required by Clockify's importer (see docs/DECISIONS.md), so
// both checkboxes are independent of each other and start unchecked.

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
	// Local draft of the Toggl email: starts with the value already saved
	// in Settings, but isn't written there until the export is confirmed
	// (see onSubmit on the "Export" button) — so a half-typed value never
	// contaminates the real setting if the user closes the modal without
	// exporting.
	private togglEmailDraft: string;
	private emailSetting: Setting | null = null;
	private emailMessageEl: HTMLElement | null = null;
	private exportButton: ButtonComponent | null = null;
	// "Include Project and Client" checkbox: unlike the email, it has no
	// invalid intermediate state to protect, so it persists immediately
	// on change (via saveIncludeProjectClient), it isn't deferred until
	// "Export" is pressed.
	private includeProjectClientSetting: Setting | null = null;

	// Same pattern as the three Toggl fields above, for Clockify: a local
	// email draft (not persisted until "Export") and "Include Project"/
	// "Include Client" checkboxes (persisted instantly, no invalid
	// intermediate state). The rest of this format's informational
	// messages live grouped in clockifyInfoEl (see below).
	private clockifyEmailDraft: string;
	private clockifyEmailSetting: Setting | null = null;
	private clockifyEmailMessageEl: HTMLElement | null = null;
	private clockifyIncludeProjectSetting: Setting | null = null;
	private clockifyIncludeClientSetting: Setting | null = null;
	// Three sections separated by a divider line, each with its own
	// heading: the "Include Project"/"Include Client" checkboxes (neither
	// required, see docs/DECISIONS.md), "Date format", and "Avoid
	// duplicates in Clockify" (both permanent notes, not tied to the
	// chosen range).
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
		// Same fix as EditTaskModal.ts: a plain <h3> inside contentEl ends
		// up on its own line, below the modal's close (X) button, instead
		// of aligned with it. Using the Modal's native title (this.setTitle(),
		// public) fixes the misalignment at the root: Obsidian already
		// positions it on the same row as that button inside modal-header.
		// Affects all three formats alike (the title doesn't depend on
		// this.format).
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

		// Visible whenever the format is Toggl, regardless of whether the
		// email is already valid — see updateFormatFields() for why the
		// field's visibility can't depend on validity. The warning below
		// does react to validity, reusing the same message classes as the
		// Historial's session edit form.
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

		// Opt-in for including Project/Client columns in the Toggl CSV
		// (generating those columns is a later task). The help text goes
		// in setDesc(), same as in SettingsTab.ts — so the Setting's own
		// layout (Obsidian's info+control row) places it below the row at
		// full width, without overlapping the switch.
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

		// Same in-place editable email pattern as Toggl (see the block
		// above); visibility also depends only on the format, never on
		// the email's validity, same reason.
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

		// Three sections separated by a divider line instead of one
		// running block of text, each with its own heading. Visibility is
		// shared (the whole block depends only on the chosen format, see
		// updateFormatFields()); each individual section's content is
		// explained next to its creation below.
		this.clockifyInfoEl = contentEl.createDiv({ cls: "task-time-tracker-export-clockify-sections" });

		// Section 1 — "Include Project" and "Include Client": Clockify's
		// only two checkboxes, independent of each other, neither
		// required (see docs/DECISIONS.md) — same behavior and spirit for
		// both, so they share a section with no divider between them.
		// Each Setting's name acts as its own row's heading, not
		// duplicated separately. Same source of truth as Settings >
		// Clockify.
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

		// Section 2 — "Date format": which option to pick in the dropdown
		// Clockify shows on import (our CSV always generates
		// YYYY-MM-DD). Permanent note, not tied to the chosen range.
		const dateFormatSection = this.clockifyInfoEl.createDiv({ cls: "task-time-tracker-export-clockify-section" });
		dateFormatSection.createEl("p", {
			text: t("export.clockifyDateFormatHeading"),
			cls: "task-time-tracker-export-clockify-heading",
		});
		dateFormatSection.createEl("p", {
			text: t("export.clockifyDateFormatNote"),
			cls: "task-time-tracker-export-clockify-note",
		});

		// Section 3 — "Avoid duplicates in Clockify": importing sessions
		// already in Clockify duplicates the entries, Clockify doesn't
		// merge or warn. Unlike "Date format" (a discreet note,
		// .task-time-tracker-export-clockify-note), this is the modal's
		// only warning about something that can genuinely go wrong
		// (duplicating hours without noticing): a prominent warning
		// style, same classes the "sessions with no project" warning used
		// before that section was removed. Permanent, not tied to the
		// chosen range.
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

	// Each platform's field visibility depends only on the chosen
	// format, never on its email's validity: if it depended on
	// needsTogglEmail()/needsClockifyEmail(), the field would disappear
	// mid-typing as soon as the value became valid (e.g. on losing
	// focus), right when the user had just finished typing it. The
	// warnings and the "Export" button do depend on the current content
	// (typed email, date range) — those are the ones that should react.
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

		// Single source of truth: if a new email was typed in this modal,
		// it's persisted as the same Settings > [Platform] > Email setting
		// before exporting, not as a value exclusive to this export.
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
