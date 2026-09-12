// settings/SettingsTab.ts
// Toggl settings (email) that TogglCsvAdapter.ts needs. No token/
// credential fields: this adapter doesn't call any API, it only
// generates a file. The "General" section holds global plugin settings;
// for now it's a placeholder with no functional content. Toggl's date/
// time format selectors were removed: the real importer requires a
// fixed format, it doesn't accept a user-chosen one (see
// TogglCsvAdapter.ts and docs/DECISIONS.md).
// getSettingDefinitions() adds the declarative view Obsidian >=1.13 uses
// for the global Settings search. Each setting lives in a
// configureX(setting) method that display() and getSettingDefinitions()
// call alike: same logic, two views. display() stays intact as a
// fallback for Obsidian <1.13 (that version doesn't know
// getSettingDefinitions and keeps calling display() as always);
// minAppVersion isn't bumped.

import {
	AbstractInputSuggest,
	App,
	PluginSettingTab,
	setIcon,
	Setting,
	SettingDefinitionItem,
	TFolder,
} from "obsidian";
import type TaskTimeTrackerPlugin from "../main";
import { t, TranslationKey } from "../i18n";
import { DEFAULT_SETTINGS, isValidEmail, LogViewLocation, PluginSettings, TaskIdFormat } from "../types";
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

// Autocomplete of folders already existing in the vault for the export
// folder setting, same UI pattern Obsidian uses to configure the
// default attachment folder. Allows typing a path that doesn't exist
// yet (ExportManager.ts auto-creates it when exporting) — autocomplete
// is only a help, not a restriction.
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

	// Historial panel location: changing this doesn't move an
	// already-open panel, it only applies the next time one is opened
	// (see activateLogView() in main.ts).
	private configureLogLocation(setting: Setting): void {
		setting
			.setName(t("settings.logLocation.name"))
			.setDesc(t("settings.logLocation.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOptions(logViewLocationOptions());
				dropdown.setValue(this.plugin.pluginState.settings.logViewLocation);
				dropdown.onChange(async (value) => {
					await this.plugin.updateSettings((settings) => {
						settings.logViewLocation = value as LogViewLocation;
					});
				});
			});
	}

	// How the tt-id:: inline field looks when Dataview renders it
	// (Reading mode / Live Preview without the cursor on the line).
	// Purely visual (class on document.body, see
	// applyTaskIdFormatClass() in main.ts); has no effect at all without
	// Dataview installed (Obsidian doesn't generate the data-dv-key
	// attributes the CSS needs) and doesn't affect the user's other
	// inline fields or Dataview queries over tt-id.
	private configureTaskIdFormat(setting: Setting): void {
		setting
			.setName(t("settings.taskIdFormat.name"))
			.setDesc(t("settings.taskIdFormat.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOptions(taskIdFormatOptions());
				dropdown.setValue(this.plugin.pluginState.settings.taskIdFormat);
				dropdown.onChange(async (value) => {
					await this.plugin.updateSettings((settings) => {
						settings.taskIdFormat = value as TaskIdFormat;
					});
					this.plugin.applyTaskIdFormatClass();
				});
			});
	}

	// Destination folder for both export formats (generic CSV and Toggl
	// CSV). Changing this doesn't move exports already made in the
	// previous folder, it only applies from the next export onward (see
	// ExportManager.ts).
	private configureExportFolder(setting: Setting): void {
		setting
			.setName(t("settings.exportFolder.name"))
			.setDesc(t("settings.exportFolder.desc"))
			.addText((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.exportsFolder).setValue(this.plugin.pluginState.settings.exportsFolder);

				const saveExportsFolder = async (path: string) => {
					await this.plugin.updateSettings((settings) => {
						settings.exportsFolder = path.trim();
					});
				};

				new FolderSuggest(this.app, text.inputEl, (path) => void saveExportsFolder(path));
				text.onChange((value) => void saveExportsFolder(value));
			});
	}

	// The visible text doesn't mention uninstalling: Obsidian preserves
	// data.json by default when a plugin is uninstalled, so a warning
	// framed around that case would be inaccurate. It's presented as
	// general good practice instead. One click, no modal: generic CSV
	// (never Toggl), full range from the first session to now, same
	// folder configured above (see exportAllEntriesToCsv() in main.ts).
	private configureExportAll(setting: Setting): void {
		setting
			.setName(t("settings.exportAll.name"))
			.setDesc(t("settings.exportAll.desc"))
			.addButton((button) =>
				button.setButtonText(t("settings.exportAll.button")).onClick(() => void this.plugin.exportAllEntriesToCsv()),
			);
	}

	// On-demand button that fixes, in one pass, tasks tracked with an
	// older plugin version that left the tt-id behind its metadata
	// (Tasks stops recognizing them in that case, see TaskIdentifier.ts).
	// Reuses appendTaskId()'s existing logic as is, no new algorithm
	// needed here. The title goes in this same row's setName(), not a
	// separate section heading (see display()); "Reparar tareas" is only
	// the button's label, never the block's title.
	private configureTasksCompat(setting: Setting): void {
		setting
			.setName(t("settings.tasksCompat.heading"))
			.setDesc(t("settings.tasksCompat.desc"))
			.addButton((button) =>
				button.setButtonText(t("settings.tasksCompat.button")).onClick(() => void this.plugin.fixMisplacedTaskIds()),
			);
	}

	// Projects/clients: base for future export adapters (Clockify and
	// others expect Project/Client columns in their importer).
	// Self-contained component, see ProjectsSection.ts.
	private renderProjectsSection(containerEl: HTMLElement): void {
		new ProjectsSection(containerEl.createDiv(), this.plugin.projectManager, () => this.plugin.refreshLogViews()).render();
	}

	// A getSettingDefinitions() `render` row is still a Setting with its
	// name/description column and its control column side by side
	// (two-column layout). The banner and the "Projects & clients" block
	// (tabs, form, list) need the row's full width, not one column —
	// hence emptying settingEl and forcing block layout (see
	// .task-time-tracker-settings-fullwidth-row in styles.css) before
	// painting its own content inside. Only applies to the declarative
	// view; display() never creates a Setting for this content.
	private makeFullWidthRow(setting: Setting): HTMLElement {
		setting.settingEl.empty();
		setting.settingEl.addClass("task-time-tracker-settings-fullwidth-row");
		return setting.settingEl.createDiv();
	}

	private renderProjectsBannerRow(setting: Setting): void {
		renderProjectsBanner(this.makeFullWidthRow(setting));
	}

	// includeBanner=false: the banner is already painted in its own row
	// (see renderProjectsBannerRow) — avoids it reappearing here below
	// every time ProjectsSection re-renders itself after an interaction
	// (add/edit/delete), since that re-render calls its own full
	// render() again.
	private renderProjectsContentRow(setting: Setting): void {
		new ProjectsSection(
			this.makeFullWidthRow(setting),
			this.plugin.projectManager,
			() => this.plugin.refreshLogViews(),
			false,
		).render();
	}

	// Email validation shared between Toggl and Clockify (same
	// isValidEmail logic, see types.ts): each platform only contributes
	// its own settings object and its translation keys (placeholder,
	// valid text); the error/valid state is computed here once for both.
	private configureEmailField(
		setting: Setting,
		// A reader and a writer instead of a reference to the settings
		// object: the state is replaced wholesale after every save (see
		// core/StateStore.ts), so capturing it would leave an orphan object.
		readEmail: () => string,
		writeEmail: (settings: PluginSettings, email: string) => void,
		placeholderKey: TranslationKey,
		validDescKey: TranslationKey,
	): void {
		const renderEmailStatus = () => {
			const email = readEmail();
			const invalid = email.length > 0 && !isValidEmail(email);
			setting.setDesc(invalid ? t("export.emailInvalid") : t(validDescKey));
			setting.descEl.toggleClass("task-time-tracker-settings-error", invalid);
		};

		setting.addText((text) =>
			text
				.setPlaceholder(t(placeholderKey))
				.setValue(readEmail())
				.onChange(async (value) => {
					await this.plugin.updateSettings((settings) => writeEmail(settings, value.trim()));
					renderEmailStatus();
				}),
		);

		renderEmailStatus();
	}

	private configureTogglEmail(setting: Setting): void {
		setting.setName(t("settings.toggl.email.name"));
		this.configureEmailField(
			setting,
			() => this.plugin.pluginState.settings.toggl.email,
			(settings, email) => {
				settings.toggl.email = email;
			},
			"settings.toggl.email.placeholder",
			"settings.toggl.email.descValid",
		);
	}

	// Opt-in for including Project/Client columns in the Toggl CSV
	// (generating those columns is a later task, gated by this setting).
	// Same source of truth as the checkbox in the export modal (see
	// ExportModal.ts): changing it here is reflected there and vice
	// versa.
	private configureTogglIncludeProjectClient(setting: Setting): void {
		setting
			.setName(t("settings.toggl.includeProjectClient.name"))
			.setDesc(t("settings.toggl.includeProjectClient.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.pluginState.settings.toggl.includeProjectClient).onChange(async (value) => {
					await this.plugin.updateSettings((settings) => {
						settings.toggl.includeProjectClient = value;
					});
				}),
			);
	}

	// The payment-wall notice (importing time entries requires a paid
	// plan or trial; the CSV is generated the same on the free plan, see
	// docs/DECISIONS.md) is NOT an error state (nothing fails or
	// blocks), so it must not reuse task-time-tracker-settings-error
	// (red, reserved for configureEmailField's invalid email — that one
	// is a real error). Icon+text banner in the theme's warning color
	// (var(--text-warning), never a fixed hex) with an "info" icon (not
	// an error/alert one), same visual pattern as
	// renderProjectsBanner() in ProjectsSection.ts but with warning
	// tokens instead of accent. Full-width via makeFullWidthRow(): works
	// the same in display() and in the declarative view, both already
	// pass it a real Setting.
	private configureClockifyPaymentWallInfo(setting: Setting): void {
		const container = this.makeFullWidthRow(setting);
		const banner = container.createDiv({ cls: "task-time-tracker-settings-warning-banner" });
		const icon = banner.createDiv({ cls: "task-time-tracker-settings-warning-banner-icon" });
		setIcon(icon, "info");
		banner.createDiv({ text: t("settings.clockify.paymentWall.desc"), cls: "task-time-tracker-settings-warning-banner-text" });
	}

	private configureClockifyEmail(setting: Setting): void {
		setting.setName(t("settings.clockify.email.name"));
		this.configureEmailField(
			setting,
			() => this.plugin.pluginState.settings.clockify.email,
			(settings, email) => {
				settings.clockify.email = email;
			},
			"settings.clockify.email.placeholder",
			"settings.clockify.email.descValid",
		);
	}

	// "Include Project" checkbox: Project is not actually required by
	// Clockify's CSV importer (see docs/DECISIONS.md), so it behaves
	// just like Include Client: opt-in, independent, unchecked by
	// default.
	private configureClockifyIncludeProject(setting: Setting): void {
		setting
			.setName(t("settings.clockify.includeProject.name"))
			.setDesc(t("settings.clockify.includeProject.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.pluginState.settings.clockify.includeProject).onChange(async (value) => {
					await this.plugin.updateSettings((settings) => {
						settings.clockify.includeProject = value;
					});
				}),
			);
	}

	// "Include Client" checkbox: independent of Include Project (see
	// above), unchecked by default, same "clean vault by default"
	// criterion as Toggl.
	private configureClockifyIncludeClient(setting: Setting): void {
		setting
			.setName(t("settings.clockify.includeClient.name"))
			.setDesc(t("settings.clockify.includeClient.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.pluginState.settings.clockify.includeClient).onChange(async (value) => {
					await this.plugin.updateSettings((settings) => {
						settings.clockify.includeClient = value;
					});
				}),
			);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// General section: no heading of its own on purpose, follows
		// Obsidian's convention of leaving the first section untitled.
		this.configureLogLocation(new Setting(containerEl));
		this.configureTaskIdFormat(new Setting(containerEl));
		this.configureExportFolder(new Setting(containerEl));
		this.configureExportAll(new Setting(containerEl));

		this.configureTasksCompat(new Setting(containerEl));

		new Setting(containerEl).setName(t("settings.projects.heading")).setHeading();
		this.renderProjectsSection(containerEl);

		new Setting(containerEl).setName(t("settings.toggl.heading")).setHeading();
		this.configureTogglEmail(new Setting(containerEl));
		this.configureTogglIncludeProjectClient(new Setting(containerEl));

		new Setting(containerEl).setName(t("settings.clockify.heading")).setHeading();
		this.configureClockifyPaymentWallInfo(new Setting(containerEl));
		this.configureClockifyEmail(new Setting(containerEl));
		this.configureClockifyIncludeProject(new Setting(containerEl));
		this.configureClockifyIncludeClient(new Setting(containerEl));
	}

	// Declarative view (Obsidian >=1.13): same settings as display(),
	// reusing the same configureX/renderX methods — there's no second
	// implementation of any setting's logic, only a second entry point
	// the global Settings search indexes. Obsidian <1.13 doesn't know
	// this method and keeps using display() as is (see the comment on
	// display()).
	// Groups (SettingDefinitionGroup, optional heading), same "rounded-
	// corner card + thin separator between rows" visual pattern Obsidian
	// uses natively on screens like Settings > Advanced.
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
				items: [
					{
						name: t("settings.tasksCompat.heading"),
						desc: t("settings.tasksCompat.desc"),
						render: (setting) => this.configureTasksCompat(setting),
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
			{
				type: "group",
				heading: t("settings.clockify.heading"),
				items: [
					{
						name: t("settings.clockify.paymentWall.name"),
						searchable: false,
						render: (setting) => this.configureClockifyPaymentWallInfo(setting),
					},
					{
						name: t("settings.clockify.email.name"),
						render: (setting) => this.configureClockifyEmail(setting),
					},
					{
						name: t("settings.clockify.includeProject.name"),
						desc: t("settings.clockify.includeProject.desc"),
						render: (setting) => this.configureClockifyIncludeProject(setting),
					},
					{
						name: t("settings.clockify.includeClient.name"),
						desc: t("settings.clockify.includeClient.desc"),
						render: (setting) => this.configureClockifyIncludeClient(setting),
					},
				],
			},
		];
	}
}
