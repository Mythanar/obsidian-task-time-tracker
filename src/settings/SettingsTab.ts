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
	App,
	PluginSettingTab,
	setIcon,
	Setting,
	SettingDefinitionGroup,
	SettingDefinitionItem,
	SettingDefinitionPage,
	SettingGroupItem,
	ToggleComponent,
} from "obsidian";
import type TaskTimeTrackerPlugin from "../main";
import { t, TranslationKey } from "../i18n";
import { DEFAULT_SETTINGS, isValidEmail, LogViewLocation, PluginSettings, TaskIdFormat } from "../types";
import { ProjectsSection } from "./ProjectsSection";
import { FolderSuggest } from "./FolderSuggest";

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

export class SettingsTab extends PluginSettingTab {
	// The "Include Client" toggle on screen, so turning "Include Project"
	// off can switch it off too (see configureClockifyIncludeProject).
	private clockifyIncludeClientToggle: ToggleComponent | null = null;
	// The Tracking folders list on screen, redrawn when a project's "Add
	// to Tracking folders" changes it (same page on Obsidian <1.13).
	private renderTrackingFolderList: (() => void) | null = null;

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

	// Folders where the note's play button shows (see
	// core/TrackingFolders.ts). Folders are only added by picking an
	// existing one from the suggestions (typing a path and pressing Enter
	// does nothing), so there is no invalid-path error to show. The list
	// sits under the description; each row has its × to remove it. A
	// listed folder that no longer exists is kept and marked "Folder not
	// found": it is never removed automatically, and recreating it with
	// the same path makes it work again with no action.
	private configureTrackingFolders(setting: Setting): void {
		setting.setName(t("settings.trackingFolders.name")).setDesc(t("settings.trackingFolders.desc"));
		const listEl = setting.infoEl.createDiv({ cls: "task-time-tracker-tracking-folders" });
		const folders = () => this.plugin.pluginState.settings.trackingFolders;

		const renderList = () => {
			listEl.empty();
			for (const path of folders()) {
				const missing = this.app.vault.getFolderByPath(path) === null;
				const row = listEl.createDiv({ cls: "task-time-tracker-tracking-folder" });
				setIcon(row.createSpan({ cls: "task-time-tracker-tracking-folder-icon" }), missing ? "folder-x" : "folder");
				row.createSpan({ text: path, cls: "task-time-tracker-tracking-folder-path" });
				if (missing) {
					row.createSpan({
						text: t("settings.trackingFolders.notFound"),
						cls: "task-time-tracker-tracking-folder-missing task-time-tracker-settings-warning",
					});
				}
				const remove = row.createDiv({
					cls: "clickable-icon task-time-tracker-tracking-folder-remove",
					attr: { "aria-label": t("settings.trackingFolders.remove"), role: "button", tabindex: "0" },
				});
				setIcon(remove, "x");
				// Never blocked: removing only hides the play button there
				// (see main.ts#removeTrackingFolder for the notice about
				// linked project folders left outside).
				const removeFolder = async () => {
					await this.plugin.removeTrackingFolder(path);
					renderList();
				};
				remove.addEventListener("click", () => void removeFolder());
				remove.addEventListener("keydown", (evt) => {
					if (evt.key !== "Enter" && evt.key !== " ") return;
					evt.preventDefault();
					void removeFolder();
				});
			}
		};

		setting.addText((text) => {
			text.setPlaceholder(t("settings.trackingFolders.placeholder"));
			new FolderSuggest(
				this.app,
				text.inputEl,
				(path) => {
					text.setValue("");
					if (folders().includes(path)) return;
					void this.plugin.setTrackingFolders([...folders(), path]).then(renderList);
				},
				(folder) => !folder.isRoot() && !folders().includes(folder.path),
			);
		});

		this.renderTrackingFolderList = renderList;
		renderList();
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
	//
	// With data from a newer data format the button is disabled and the
	// description becomes the same lock warning as the export modal (see
	// ExportModal.ts).
	private configureExportAll(setting: Setting): void {
		const locked = this.plugin.store.isNewerFormat();
		setting
			.setName(t("settings.exportAll.name"))
			.setDesc(t(locked ? "export.newerFormat" : "settings.exportAll.desc"))
			.addButton((button) =>
				button
					.setButtonText(t("settings.exportAll.button"))
					.setDisabled(locked)
					.onClick(() => void this.plugin.exportAllEntriesToCsv()),
			);
		setting.descEl.toggleClass("task-time-tracker-settings-warning", locked);
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
		this.newProjectsSection(containerEl.createDiv()).render();
	}

	private newProjectsSection(containerEl: HTMLElement): ProjectsSection {
		return new ProjectsSection(containerEl, this.plugin.projectManager, () => this.plugin.onProjectsChanged(), {
			app: this.app,
			getTrackingFolders: () => this.plugin.pluginState.settings.trackingFolders,
			addTrackingFolder: async (path) => {
				const folders = this.plugin.pluginState.settings.trackingFolders;
				if (!folders.includes(path)) await this.plugin.setTrackingFolders([...folders, path]);
				this.renderTrackingFolderList?.();
			},
		});
	}

	// A getSettingDefinitions() `render` row is still a Setting with its
	// name/description column and its control column side by side
	// (two-column layout). The "Projects & clients" block (tabs, form,
	// list) needs the row's full width, not one column — hence emptying
	// settingEl and forcing block layout (see
	// .task-time-tracker-settings-fullwidth-row in styles.css) before
	// painting its own content inside. Only applies to the declarative
	// view; display() never creates a Setting for this content.
	private makeFullWidthRow(setting: Setting): HTMLElement {
		setting.settingEl.empty();
		setting.settingEl.addClass("task-time-tracker-settings-fullwidth-row");
		return setting.settingEl.createDiv();
	}

	private renderProjectsContentRow(setting: Setting): void {
		this.newProjectsSection(this.makeFullWidthRow(setting)).render();
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
	// the other settings banners. Full-width via makeFullWidthRow(): works
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
					// Turning Project off turns Client off too: in Clockify a
					// client only reaches the import through its project.
					// Turning Project back on leaves Client as it is.
					const clearClient = !value && this.plugin.pluginState.settings.clockify.includeClient;
					await this.plugin.updateSettings((settings) => {
						settings.clockify.includeProject = value;
						if (clearClient) settings.clockify.includeClient = false;
					});
					if (clearClient) this.clockifyIncludeClientToggle?.setValue(false);
				}),
			);
	}

	// "Include Client" checkbox: independent of Include Project (see
	// above), checked by default like it since 0.0.35 (see types.ts),
	// except that turning Project off turns it off too.
	private configureClockifyIncludeClient(setting: Setting): void {
		setting
			.setName(t("settings.clockify.includeClient.name"))
			.setDesc(t("settings.clockify.includeClient.desc"))
			.addToggle((toggle) => {
				this.clockifyIncludeClientToggle = toggle;
				toggle.setValue(this.plugin.pluginState.settings.clockify.includeClient).onChange(async (value) => {
					await this.plugin.updateSettings((settings) => {
						settings.clockify.includeClient = value;
					});
				});
			});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// General section: no heading of its own on purpose, follows
		// Obsidian's convention of leaving the first section untitled.
		this.configureTrackingFolders(new Setting(containerEl));
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
	// Layout: General settings live on the main page, grouped under
	// headings (Tracking, Task identifier, History panel); the larger
	// blocks go to native sub-pages (type "page"), reached through a
	// chevron row at the end. Native sub-pages, not custom tabs: Obsidian
	// indexes the settings inside them and its search navigates into the
	// sub-page and scrolls to the match, which custom tabs drawn inside a
	// render row can't offer (Obsidian only indexes what is declared).
	// Same pattern as the Tasks plugin. Groups use the "rounded-corner
	// card + thin separator between rows" visual pattern Obsidian uses
	// natively on screens like Settings > Advanced.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...this.trackingGroup(),
			{
				type: "group",
				heading: t("settings.group.taskIdentifier"),
				items: [
					{
						name: t("settings.taskIdFormat.name"),
						desc: t("settings.taskIdFormat.desc"),
						render: (setting) => this.configureTaskIdFormat(setting),
					},
					{
						name: t("settings.tasksCompat.heading"),
						desc: t("settings.tasksCompat.desc"),
						render: (setting) => this.configureTasksCompat(setting),
					},
				],
			},
			{
				type: "group",
				heading: t("settings.group.historyPanel"),
				items: [
					{
						name: t("settings.logLocation.name"),
						desc: t("settings.logLocation.desc"),
						render: (setting) => this.configureLogLocation(setting),
					},
				],
			},
			{
				type: "group",
				items: [this.projectsPage(), this.exportPage()],
			},
		];
	}

	// First section of the main page. The English name is also a search
	// alias, so "Tracking folders" finds it in any language.
	private trackingGroup(): SettingDefinitionGroup[] {
		const items: SettingGroupItem[] = [
			{
				name: t("settings.trackingFolders.name"),
				desc: t("settings.trackingFolders.desc"),
				aliases: ["Tracking folders"],
				render: (setting) => this.configureTrackingFolders(setting),
			},
		];
		return [{ type: "group", heading: t("settings.group.tracking"), items }];
	}

	// No heading inside the page: the page title already says "Clients &
	// projects". Each row needs its own name, different from every other
	// row and from the page itself: Obsidian keys rows by name and logs
	// "duplicate setting key" otherwise. Neither name is shown
	// (makeFullWidthRow empties the row).
	private projectsPage(): SettingDefinitionPage {
		return {
			type: "page",
			name: t("settings.projects.heading"),
			desc: t("settings.page.projects.desc"),
			items: [
				{
					type: "group",
					items: [
						{
							name: t("settings.projects.title"),
							searchable: false,
							render: (setting) => this.renderProjectsContentRow(setting),
						},
					],
				},
			],
		};
	}

	// Future platforms go here too, each in its own group below Clockify.
	private exportPage(): SettingDefinitionPage {
		return {
			type: "page",
			name: t("settings.page.export.name"),
			desc: t("settings.page.export.desc"),
			items: [
				{
					type: "group",
					items: [
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
			],
		};
	}
}
