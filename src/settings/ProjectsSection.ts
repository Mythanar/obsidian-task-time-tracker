// settings/ProjectsSection.ts
// Settings > "Clients & projects": two independent lists (format 2, see
// core/ClientMigration.ts), Clients above Projects. Each list is its own
// block (NameListBlock below) with a count next to its title, "One by
// one" / "Paste list" tabs, and rows with an edit (pencil) and a delete
// (trash) button. Self-contained component (same spirit as
// TimeLogView.ts): manages its own transient state (active tab, drafts,
// errors, pending delete confirmation) and re-renders itself on every
// change, without touching the rest of SettingsTab.ts. A new instance per
// opening of the Settings tab (see SettingsTab.ts#display) — losing the
// draft when Settings closes is acceptable, no other form in the plugin
// persists one either.
//
// "Project by folder" (see core/ProjectFolders.ts): a project may have
// an optional folder, set in the "One by one" form and in the row's
// inline edit. "Paste list" stays names only. A row with a folder shows
// its path, plus a state when the folder is outside Tracking folders
// ("outside", with "Add to Tracking folders") or doesn't exist anymore
// ("Folder not found", with "Re-link" and "Remove link"; nothing is
// deleted).

import { App, setIcon } from "obsidian";
import { t, TranslationKey } from "../i18n";
import { ListKind, NameResult, ProjectManager } from "../core/ProjectManager";
import { hasLinkImpact, normalizeFolderPath, projectWithFolder } from "../core/ProjectFolders";
import { isInTrackingFolders } from "../core/TrackingFolders";
import { Project } from "../types";
import { confirmLinkFolder } from "../ui/LinkFolderModal";
import { FolderSuggest } from "./FolderSuggest";

type ListTab = "one" | "paste";
type NameError = "empty" | "duplicate" | null;

// Folder problems shown under the folder field. "outside" carries the
// "Add to Tracking folders" button, which links in one step.
type FolderError = { kind: "taken"; takenBy: string } | { kind: "outside" } | { kind: "missing" } | null;

// Result of saving a row's inline edit.
type EditOutcome =
	| { kind: "saved" }
	| { kind: "cancelled" }
	| { kind: "locked" }
	| { kind: "error"; name: NameError; folder: FolderError };

// What the project folder field needs from the plugin.
export interface ProjectFolderDeps {
	app: App;
	getTrackingFolders(): readonly string[];
	// "Add to Tracking folders" on an outside row (the folder is already
	// linked, only the list changes).
	addTrackingFolder(path: string): Promise<void>;
}

// Texts per list kind.
interface ListTexts {
	title: TranslationKey;
	countSingular: TranslationKey;
	countPlural: TranslationKey;
	namePlaceholder: TranslationKey;
	pastePlaceholder: TranslationKey;
	pasteButton: TranslationKey;
	pasteAddedSingular: TranslationKey;
	pasteAddedPlural: TranslationKey;
	nameRequired: TranslationKey;
	duplicate: TranslationKey;
	editAriaLabel: TranslationKey;
	saveAriaLabel: TranslationKey;
	deleteAriaLabel: TranslationKey;
	deleteConfirmSingular: TranslationKey;
	deleteConfirmPlural: TranslationKey;
}

const TEXTS: Record<ListKind, ListTexts> = {
	client: {
		title: "settings.clients.title",
		countSingular: "settings.clients.countSingular",
		countPlural: "settings.clients.countPlural",
		namePlaceholder: "settings.clients.namePlaceholder",
		pastePlaceholder: "settings.clients.pastePlaceholder",
		pasteButton: "settings.clients.pasteButton",
		pasteAddedSingular: "settings.clients.pasteAddedSingular",
		pasteAddedPlural: "settings.clients.pasteAddedPlural",
		nameRequired: "settings.clients.nameRequired",
		duplicate: "settings.clients.duplicateError",
		editAriaLabel: "settings.clients.editAriaLabel",
		saveAriaLabel: "settings.clients.saveAriaLabel",
		deleteAriaLabel: "settings.clients.deleteAriaLabel",
		deleteConfirmSingular: "settings.clients.deleteConfirmSingular",
		deleteConfirmPlural: "settings.clients.deleteConfirmPlural",
	},
	project: {
		title: "settings.projects.title",
		countSingular: "settings.projects.countSingular",
		countPlural: "settings.projects.countPlural",
		namePlaceholder: "settings.projects.namePlaceholder",
		pastePlaceholder: "settings.projects.pastePlaceholder",
		pasteButton: "settings.projects.pasteButton",
		pasteAddedSingular: "settings.projects.pasteAddedSingular",
		pasteAddedPlural: "settings.projects.pasteAddedPlural",
		nameRequired: "settings.projects.nameRequired",
		duplicate: "settings.projects.duplicateError",
		editAriaLabel: "settings.projects.editAriaLabel",
		saveAriaLabel: "settings.projects.saveAriaLabel",
		deleteAriaLabel: "settings.projects.deleteAriaLabel",
		deleteConfirmSingular: "settings.projects.deleteConfirmSingular",
		deleteConfirmPlural: "settings.projects.deleteConfirmPlural",
	},
};

export class ProjectsSection {
	constructor(
		private containerEl: HTMLElement,
		private manager: ProjectManager,
		// After removing, renaming or linking an item in use, the
		// Historial may already have cards rendered showing it — this
		// callback refreshes those views so they don't stay stale until
		// the next external refresh.
		private onProjectsChanged: () => void,
		private folderDeps: ProjectFolderDeps,
	) {}

	render(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("task-time-tracker-projects");

		// Data from a newer plugin version: read-only lists, no forms, no
		// editing, no delete (see ProjectManager#isLocked).
		if (this.manager.isLocked()) {
			this.renderLockedNotice(el);
		}

		// Clients above Projects (client first, everywhere).
		for (const kind of ["client", "project"] as const) {
			new NameListBlock(el.createDiv({ cls: "task-time-tracker-projects-block" }), kind, this.manager, {
				onChanged: this.onProjectsChanged,
				onLocked: () => this.render(),
				folders: kind === "project" ? this.folderDeps : null,
			}).render();
		}
	}

	// Same warning banner as Clockify's payment-wall notice (see
	// SettingsTab.ts#configureClockifyPaymentWallInfo).
	private renderLockedNotice(el: HTMLElement): void {
		const banner = el.createDiv({ cls: "task-time-tracker-settings-warning-banner" });
		const icon = banner.createDiv({ cls: "task-time-tracker-settings-warning-banner-icon" });
		setIcon(icon, "alert-triangle");
		banner.createDiv({ text: t("settings.projects.newerFormat"), cls: "task-time-tracker-settings-warning-banner-text" });
	}
}

class NameListBlock {
	private activeTab: ListTab = "one";

	private nameDraft = "";
	private folderDraft = "";
	private addError: NameError = null;
	private addFolderError: FolderError = null;

	private pasteDraft = "";
	// Outcome of the last paste, shown under the box until the next change.
	private pasteResult: { added: number; skipped: string[] } | null = null;

	private deleteConfirmId: string | null = null;

	// Inline per-row editing: a single row at a time. editingId changes
	// reference on every startEdit()/cancelEdit()/saveEdit() — each input's
	// blur handler, captured by closure, compares against that reference to
	// tell a real blur (user leaves the field) apart from one self-induced
	// by our own render() on save, avoiding a duplicate cancelEdit(). See
	// bindEditInputEvents().
	private editing: { id: string; focusFolder?: boolean } | null = null;
	private editDraft = "";
	private editFolderDraft = "";
	private editError: NameError = null;
	private editFolderError: FolderError = null;
	// A save waiting for the D1/D2 dialog: blur must not cancel the edit
	// while the dialog has the focus.
	private saving = false;
	// When a folder suggestion was last picked: the Enter that picks it
	// must not also save (see submitOnEnter()).
	private lastFolderChoice = 0;
	// Each folder field's suggestion popover: Escape while it is open
	// only closes the popover, it doesn't cancel the edit.
	private folderSuggests = new WeakMap<HTMLInputElement, FolderSuggest>();

	private texts: ListTexts;

	constructor(
		private el: HTMLElement,
		private kind: ListKind,
		private manager: ProjectManager,
		private callbacks: { onChanged: () => void; onLocked: () => void; folders: ProjectFolderDeps | null },
	) {
		this.texts = TEXTS[kind];
	}

	render(): void {
		const el = this.el;
		el.empty();
		const items = this.manager.getItems(this.kind);

		const header = el.createDiv({ cls: "task-time-tracker-projects-block-header" });
		header.createEl("h3", { text: t(this.texts.title), cls: "task-time-tracker-projects-block-title" });
		header.createSpan({
			text: `${items.length} ${t(items.length === 1 ? this.texts.countSingular : this.texts.countPlural)}`,
			cls: "task-time-tracker-projects-count",
		});

		const locked = this.manager.isLocked();
		if (!locked) {
			this.renderTabs(el);
			if (this.activeTab === "one") this.renderOneByOneForm(el);
			else this.renderPasteListForm(el);
		}

		const list = el.createDiv({ cls: "task-time-tracker-projects-list" });
		for (const item of items) {
			if (locked) {
				const row = list.createDiv({ cls: "task-time-tracker-projects-row" });
				const main = row.createDiv({ cls: "task-time-tracker-projects-row-main" });
				main.createSpan({ text: item.name, cls: "task-time-tracker-projects-row-name" });
				this.renderFolderLine(main, item, false);
			} else if (this.deleteConfirmId === item.id) {
				this.renderDeleteConfirm(list, item);
			} else {
				this.renderRow(list, item);
			}
		}
	}

	private renderTabs(el: HTMLElement): void {
		const tabs = el.createDiv({ cls: "task-time-tracker-log-datenav-mode task-time-tracker-projects-tabs" });

		const makeTab = (label: string, tab: ListTab) => {
			const btn = tabs.createEl("button", { text: label, cls: "task-time-tracker-log-datenav-mode-btn" });
			btn.toggleClass("is-active", this.activeTab === tab);
			btn.addEventListener("click", () => {
				if (this.activeTab === tab) return;
				this.activeTab = tab;
				this.render();
			});
		};

		makeTab(t("settings.projects.tabOneByOne"), "one");
		makeTab(t("settings.projects.tabPasteList"), "paste");
	}

	private renderOneByOneForm(el: HTMLElement): void {
		const form = el.createDiv({ cls: "task-time-tracker-projects-form" });
		const fields = form.createDiv({ cls: "task-time-tracker-projects-form-fields" });

		const nameInput = fields.createEl("input", { cls: "task-time-tracker-log-edit-input" });
		nameInput.type = "text";
		nameInput.placeholder = t(this.texts.namePlaceholder);
		nameInput.value = this.nameDraft;
		let errorEl: HTMLElement | null = null;
		const folders = this.callbacks.folders;

		const addBtn = (): HTMLButtonElement => {
			const btn = fields.createEl("button", { text: t("settings.projects.addButton"), cls: "mod-cta" });
			btn.addEventListener("click", () => {
				if (btn.getAttribute("aria-disabled") === "true") return;
				void this.handleAdd();
			});
			return btn;
		};

		let folderErrorEl: HTMLElement | null = null;
		let btn: HTMLButtonElement;
		if (folders) {
			const folderInput = this.createFolderInput(fields, folders, null, this.folderDraft, (value) => {
				this.folderDraft = value;
				this.addFolderError = null;
				folderErrorEl?.remove();
				folderErrorEl = null;
			});
			folderInput.addEventListener("keydown", (evt) => {
				if (evt.key !== "Enter" || evt.isComposing || this.nameDraft.trim() === "") return;
				evt.preventDefault();
				this.submitOnEnter(() => void this.handleAdd());
			});
			btn = addBtn();
			// Projects: "Add" stays focusable but unavailable until there
			// is a name (aria-disabled, not disabled).
			const syncAddBtn = () => {
				const empty = nameInput.value.trim() === "";
				btn.setAttribute("aria-disabled", String(empty));
				btn.toggleClass("task-time-tracker-is-unavailable", empty);
			};
			syncAddBtn();
			nameInput.addEventListener("input", syncAddBtn);
		} else {
			btn = addBtn();
		}

		// The error answers the text that was submitted: it goes away as
		// soon as that text changes (removed in place, without a re-render
		// that would take the focus away from the field).
		nameInput.addEventListener("input", () => {
			this.nameDraft = nameInput.value;
			this.addError = null;
			errorEl?.remove();
			errorEl = null;
		});
		nameInput.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				if (btn.getAttribute("aria-disabled") === "true") return;
				void this.handleAdd();
			}
		});

		if (this.addError) {
			errorEl = form.createEl("p", { text: t(this.errorKey(this.addError)), cls: "task-time-tracker-log-edit-error" });
		}
		if (this.addFolderError) {
			folderErrorEl = this.renderFolderError(form, this.addFolderError, () => void this.handleAdd(true));
		}
	}

	// The "Project folder (optional)" field: suggests every folder of the
	// vault except the root and the folders another project already has,
	// whether or not they are inside Tracking folders. Picking one outside
	// Tracking folders is handled on save, by the usual "outside" warning
	// with "Add to Tracking folders".
	private createFolderInput(
		container: HTMLElement,
		deps: ProjectFolderDeps,
		projectId: string | null,
		value: string,
		onInput: (value: string) => void,
	): HTMLInputElement {
		const input = container.createEl("input", {
			cls: "task-time-tracker-log-edit-input task-time-tracker-projects-folder-input",
		});
		input.type = "text";
		input.placeholder = t("settings.projects.folderPlaceholder");
		input.setAttribute("aria-label", t("settings.projects.folderPlaceholder"));
		input.value = value;
		input.addEventListener("input", () => onInput(input.value));
		const suggest = new FolderSuggest(
			deps.app,
			input,
			(path) => {
				this.lastFolderChoice = Date.now();
				onInput(path);
				input.focus();
			},
			(folder) =>
				!folder.isRoot() &&
				!projectWithFolder(this.manager.getProjects(), folder.path, projectId ?? undefined),
		);
		this.folderSuggests.set(input, suggest);
		return input;
	}

	private renderFolderError(container: HTMLElement, error: NonNullable<FolderError>, onAddToTracking: () => void): HTMLElement {
		const el = container.createDiv({ cls: "task-time-tracker-projects-folder-error" });
		if (error.kind === "taken") {
			el.createEl("p", {
				text: t("settings.projects.folderTaken", { project: error.takenBy }),
				cls: "task-time-tracker-log-edit-error",
			});
		} else if (error.kind === "missing") {
			el.createEl("p", { text: t("settings.projects.folderNotFound"), cls: "task-time-tracker-log-edit-error" });
		} else {
			el.addClass("task-time-tracker-projects-folder-outside");
			el.createSpan({ text: t("settings.projects.folderOutside"), cls: "task-time-tracker-settings-warning" });
			const btn = el.createEl("button", { text: t("settings.projects.addToTracking") });
			btn.addEventListener("mousedown", (evt) => evt.preventDefault());
			btn.addEventListener("click", onAddToTracking);
		}
		return el;
	}

	private errorKey(error: "empty" | "duplicate"): TranslationKey {
		return error === "empty" ? this.texts.nameRequired : this.texts.duplicate;
	}

	// Checks done before the D1/D2 dialog, on the in-memory state, so the
	// dialog never shows for a save that would be refused anyway. The
	// save re-checks them against the state just read from disk.
	private precheckFolder(projectId: string | null, rawFolder: string, addToTracking: boolean): FolderError {
		const deps = this.callbacks.folders;
		const folder = normalizeFolderPath(rawFolder);
		if (!deps || !folder) return null;
		const current = projectId ? this.manager.getProjects().find((p) => p.id === projectId)?.folder : undefined;
		if (folder === current) return null;
		if (deps.app.vault.getFolderByPath(folder) === null) return { kind: "missing" };
		const other = projectWithFolder(this.manager.getProjects(), folder, projectId ?? undefined);
		if (other) return { kind: "taken", takenBy: other.name };
		if (!addToTracking && !isInTrackingFolders(folder, deps.getTrackingFolders())) return { kind: "outside" };
		return null;
	}

	// D1/D2 when the new or changed link changes the project of some
	// task. Resolves false when the user cancels.
	private async confirmLink(projectId: string | null, name: string, rawFolder: string): Promise<boolean> {
		const deps = this.callbacks.folders;
		const folder = normalizeFolderPath(rawFolder);
		if (!deps || !folder) return true;
		const current = projectId ? this.manager.getProjects().find((p) => p.id === projectId)?.folder : undefined;
		if (folder === current) return true;
		const impact = this.manager.linkImpact(projectId, folder);
		if (!hasLinkImpact(impact)) return true;
		return confirmLinkFolder(deps.app, name.trim(), folder, impact);
	}

	private async handleAdd(addToTracking = false): Promise<void> {
		if (this.kind === "client") {
			this.applyAddResult(await this.manager.add(this.kind, this.nameDraft));
			return;
		}
		const name = this.nameDraft;
		if (name.trim() === "") return;
		const folderError = this.precheckFolder(null, this.folderDraft, addToTracking);
		if (folderError) {
			this.addError = null;
			this.addFolderError = folderError;
			this.render();
			return;
		}
		if (this.manager.isNameTaken("project", name)) {
			this.applyAddResult({ ok: false, error: "duplicate" });
			return;
		}
		if (!(await this.confirmLink(null, name, this.folderDraft))) return;
		this.applyAddResult(await this.manager.saveProject(null, name, this.folderDraft || null, { addToTracking }));
	}

	private applyAddResult(result: NameResult): void {
		if (!result.ok && result.error === "newer-format") {
			this.callbacks.onLocked();
			return;
		}
		this.addError = null;
		this.addFolderError = null;
		if (!result.ok) {
			if (result.error === "empty-name") this.addError = "empty";
			else if (result.error === "duplicate") this.addError = "duplicate";
			else this.addFolderError = this.folderErrorOf(result);
			this.render();
			return;
		}

		this.nameDraft = "";
		this.folderDraft = "";
		this.render();
		this.callbacks.onChanged();
	}

	private folderErrorOf(result: NameResult): FolderError {
		if (result.ok) return null;
		if (result.error === "folder-taken") return { kind: "taken", takenBy: result.takenBy };
		if (result.error === "folder-outside") return { kind: "outside" };
		return null;
	}

	private renderPasteListForm(el: HTMLElement): void {
		const form = el.createDiv({ cls: "task-time-tracker-projects-form" });

		const textarea = form.createEl("textarea", { cls: "task-time-tracker-projects-textarea" });
		textarea.placeholder = t(this.texts.pastePlaceholder);
		textarea.value = this.pasteDraft;
		let resultEl: HTMLElement | null = null;
		textarea.addEventListener("input", () => {
			this.pasteDraft = textarea.value;
			this.pasteResult = null;
			resultEl?.remove();
			resultEl = null;
		});

		if (this.pasteResult) {
			const { added, skipped } = this.pasteResult;
			resultEl = form.createDiv({ cls: "task-time-tracker-projects-paste-result" });
			resultEl.createEl("p", {
				text: t(added === 1 ? this.texts.pasteAddedSingular : this.texts.pasteAddedPlural, { count: String(added) }),
				cls: "task-time-tracker-log-edit-message",
			});
			if (skipped.length > 0) {
				const quote = (name: string) => t("notice.migrationQuoted", { name });
				resultEl.createEl("p", {
					text: t("settings.lists.pasteSkipped", { names: skipped.map(quote).join(", ") }),
					cls: "task-time-tracker-log-edit-message task-time-tracker-log-edit-message-warning",
				});
			}
		}

		const importBtn = form.createEl("button", {
			text: t(this.texts.pasteButton),
			cls: "mod-cta task-time-tracker-projects-import-btn",
		});
		importBtn.addEventListener("click", () => void this.handleImport());
	}

	private async handleImport(): Promise<void> {
		const result = await this.manager.importNames(this.kind, this.pasteDraft);
		if (!result.ok && result.error === "newer-format") {
			this.callbacks.onLocked();
			return;
		}
		if (!result.ok) return;
		// Nothing pasted (only empty lines): nothing to report.
		if (result.added.length === 0 && result.skipped.length === 0) return;

		this.pasteDraft = "";
		this.pasteResult = { added: result.added.length, skipped: result.skipped };
		this.render();
	}

	private renderRow(list: HTMLElement, item: { id: string; name: string }): void {
		const row = list.createDiv({ cls: "task-time-tracker-projects-row" });
		const actions = (): HTMLElement => row.createDiv({ cls: "task-time-tracker-projects-row-actions" });

		if (this.editing?.id === item.id) {
			this.renderEditInput(row);
			const saveBtn = actions().createEl("button", {
				cls: "task-time-tracker-icon-btn clickable-icon task-time-tracker-projects-row-save",
			});
			setIcon(saveBtn, "check");
			saveBtn.setAttribute("aria-label", t(this.texts.saveAriaLabel));
			// preventDefault on mousedown: keeps the input from losing focus
			// (and thus firing its blur, which would cancel the edit) when
			// clicking this button — the save runs on the normal click that
			// follows.
			saveBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
			saveBtn.addEventListener("click", () => void this.saveEdit());
			return;
		}

		const main = row.createDiv({ cls: "task-time-tracker-projects-row-main" });
		// The name itself is still clickable to edit, as before the pencil.
		const name = main.createSpan({
			text: item.name,
			cls: "task-time-tracker-projects-row-name task-time-tracker-projects-row-editable",
		});
		name.addEventListener("mousedown", (evt) => evt.preventDefault());
		name.addEventListener("click", () => this.startEdit(item.id, item.name));
		this.renderFolderLine(main, item, true);

		const buttons = actions();
		const editBtn = buttons.createEl("button", {
			cls: "task-time-tracker-icon-btn clickable-icon task-time-tracker-projects-row-edit",
		});
		setIcon(editBtn, "pencil");
		editBtn.setAttribute("aria-label", t(this.texts.editAriaLabel));
		editBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
		editBtn.addEventListener("click", () => this.startEdit(item.id, item.name));

		const deleteBtn = buttons.createEl("button", {
			cls: "task-time-tracker-icon-btn clickable-icon task-time-tracker-projects-row-delete",
		});
		setIcon(deleteBtn, "trash-2");
		deleteBtn.setAttribute("aria-label", t(this.texts.deleteAriaLabel));
		deleteBtn.addEventListener("click", () => {
			// Not in use (count 0): deleted directly, no dialog (no real
			// reason for the friction). In use, the confirmation below warns
			// how many tasks will silently lose it.
			if (this.manager.countTasksUsing(this.kind, item.id) === 0) {
				void this.manager.remove(this.kind, item.id).then(() => {
					this.render();
					this.callbacks.onChanged();
				});
				return;
			}
			this.deleteConfirmId = item.id;
			this.render();
		});
	}

	// The project's folder under its name, only when it has one, with
	// its state: "outside" (not in Tracking folders, still linked) or
	// "missing" (folder not found; the link and the tasks' project stay).
	// States are told by text and icon, never by color alone.
	private renderFolderLine(container: HTMLElement, item: { id: string }, interactive: boolean): void {
		const deps = this.callbacks.folders;
		const folder = (item as Project).folder;
		if (!deps || !folder) return;

		const missing = deps.app.vault.getFolderByPath(folder) === null;
		const outside = !missing && !isInTrackingFolders(folder, deps.getTrackingFolders());

		const line = container.createDiv({ cls: "task-time-tracker-projects-row-folder" });
		setIcon(line.createSpan({ cls: "task-time-tracker-projects-row-folder-icon" }), missing ? "folder-x" : "folder");
		line.createSpan({ text: folder, cls: "task-time-tracker-projects-row-folder-path" });
		if (!missing && !outside) return;

		const state = container.createDiv({ cls: "task-time-tracker-projects-row-folder-state" });
		state.toggleClass("is-missing", missing);
		state.toggleClass("is-outside", outside);
		setIcon(state.createSpan({ cls: "task-time-tracker-projects-row-folder-icon" }), missing ? "alert-triangle" : "info");
		state.createSpan({
			text: t(missing ? "settings.projects.folderNotFound" : "settings.projects.folderOutsideState"),
			cls: missing ? "task-time-tracker-settings-warning" : "task-time-tracker-projects-row-folder-outside-text",
		});
		if (!interactive) return;

		const actions = state.createDiv({ cls: "task-time-tracker-projects-row-folder-actions" });
		const button = (text: string, onClick: () => void) =>
			actions.createEl("button", { text, cls: "task-time-tracker-projects-row-folder-btn" }).addEventListener("click", onClick);
		if (outside) {
			button(t("settings.projects.addToTracking"), () => {
				void deps.addTrackingFolder(folder).then(() => this.render());
			});
			return;
		}
		button(t("settings.projects.relink"), () => {
			this.startEdit(item.id, (item as Project).name, { folder: "", focusFolder: true });
		});
		button(t("settings.projects.removeLink"), () => {
			void this.manager.unlinkFolder(item.id).then(() => {
				this.render();
				this.callbacks.onChanged();
			});
		});
	}

	// Same help text as the creation form (nameRequired / duplicate),
	// always visible under the field when there's an error — never a
	// tooltip. Projects also get the folder field.
	private renderEditInput(row: HTMLElement): void {
		const wrapper = row.createDiv({ cls: "task-time-tracker-projects-row-edit-field" });
		const input = wrapper.createEl("input", { cls: "task-time-tracker-log-edit-input" });
		input.type = "text";
		input.value = this.editDraft;
		let errorEl: HTMLElement | null = null;
		input.addEventListener("input", () => {
			this.editDraft = input.value;
			this.editError = null;
			errorEl?.remove();
			errorEl = null;
		});
		this.bindEditInputEvents(input, wrapper);

		const deps = this.callbacks.folders;
		const editingId = this.editing?.id ?? null;
		let folderInput: HTMLInputElement | null = null;
		let folderErrorEl: HTMLElement | null = null;
		if (deps && editingId) {
			folderInput = this.createFolderInput(wrapper, deps, editingId, this.editFolderDraft, (value) => {
				this.editFolderDraft = value;
				this.editFolderError = null;
				folderErrorEl?.remove();
				folderErrorEl = null;
			});
			this.bindEditInputEvents(folderInput, wrapper);
		}

		const target = this.editing?.focusFolder && folderInput ? folderInput : input;
		target.focus();
		target.select();

		if (this.editError) {
			errorEl = wrapper.createEl("p", { text: t(this.errorKey(this.editError)), cls: "task-time-tracker-log-edit-error" });
		}
		if (this.editFolderError) {
			folderErrorEl = this.renderFolderError(wrapper, this.editFolderError, () => void this.saveEdit(true));
		}
	}

	// Enter saves (same as the check button), Esc cancels without saving.
	// Losing focus only cancels if it's still the same editing "session"
	// as when this input was created — see the comment next to `editing`
	// — and the focus left the whole row's fields: moving between the
	// name and the folder field, or picking a folder suggestion (which
	// hands the focus back to the field), keeps the edit open.
	private bindEditInputEvents(input: HTMLInputElement, wrapper: HTMLElement): void {
		const session = this.editing;
		// Capture phase: runs before the suggestion popover handles the
		// same key and closes itself.
		input.addEventListener("keydown", (evt) => {
			if (evt.isComposing) return;
			if (evt.key === "Escape" && this.folderSuggests.get(input)?.isOpen) return;
			if (evt.key === "Enter") {
				evt.preventDefault();
				this.submitOnEnter(() => void this.saveEdit());
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				this.cancelEdit();
			}
		}, true);
		input.addEventListener("blur", () => {
			window.setTimeout(() => {
				if (this.editing !== session || this.saving) return;
				// The field's own document: Settings may be in its own window.
				if (wrapper.contains(wrapper.ownerDocument.activeElement)) return;
				this.cancelEdit();
			}, 200);
		});
	}

	// Enter in a folder field may also be picking a suggestion (the
	// suggestion popover handles that same key): the submit waits a tick
	// and is skipped if a suggestion was just picked, so Enter picks the
	// folder and a second Enter saves.
	private submitOnEnter(submit: () => void): void {
		window.setTimeout(() => {
			if (Date.now() - this.lastFolderChoice < 150) return;
			submit();
		}, 0);
	}

	private startEdit(id: string, currentName: string, options: { folder?: string; focusFolder?: boolean } = {}): void {
		const project = this.kind === "project" ? this.manager.getProjects().find((p) => p.id === id) : undefined;
		this.editing = { id, focusFolder: options.focusFolder };
		this.editDraft = currentName;
		this.editFolderDraft = options.folder ?? project?.folder ?? "";
		this.editError = null;
		this.editFolderError = null;
		this.render();
	}

	private cancelEdit(): void {
		if (!this.editing) return;
		this.editing = null;
		this.editError = null;
		this.editFolderError = null;
		this.render();
	}

	private async saveEdit(addToTracking = false): Promise<void> {
		const editing = this.editing;
		if (!editing || this.saving) return;

		this.saving = true;
		let outcome: EditOutcome;
		try {
			outcome = await this.saveEditDraft(editing.id, addToTracking);
		} finally {
			this.saving = false;
		}
		if (outcome.kind === "locked") {
			this.callbacks.onLocked();
			return;
		}
		if (outcome.kind !== "saved") {
			if (outcome.kind === "error") {
				this.editError = outcome.name;
				this.editFolderError = outcome.folder;
			}
			// New reference: invalidates the "session" the previous input
			// captured, so its blur (fired by the re-render below) doesn't
			// cancel the edit we just reopened (with the error visible, or
			// as it was after cancelling the D1/D2 dialog).
			this.editing = { ...editing };
			this.render();
			return;
		}

		this.editing = null;
		this.editError = null;
		this.editFolderError = null;
		this.render();
		this.callbacks.onChanged();
	}

	// Projects: name and folder in one save, after the folder checks and
	// the D1/D2 confirmation. Cancelling the dialog saves nothing and
	// keeps the edit open with what was typed. An empty folder field
	// unlinks.
	private async saveEditDraft(id: string, addToTracking: boolean): Promise<EditOutcome> {
		if (this.kind === "client") return this.outcomeOf(await this.manager.rename(this.kind, id, this.editDraft));
		if (this.editDraft.trim() === "") return { kind: "error", name: "empty", folder: null };
		const folderError = this.precheckFolder(id, this.editFolderDraft, addToTracking);
		if (folderError) return { kind: "error", name: null, folder: folderError };
		if (this.manager.isNameTaken("project", this.editDraft, id)) return { kind: "error", name: "duplicate", folder: null };
		if (!(await this.confirmLink(id, this.editDraft, this.editFolderDraft))) return { kind: "cancelled" };
		return this.outcomeOf(
			await this.manager.saveProject(id, this.editDraft, this.editFolderDraft || null, { addToTracking }),
		);
	}

	private outcomeOf(result: NameResult): EditOutcome {
		if (result.ok) return { kind: "saved" };
		if (result.error === "newer-format") return { kind: "locked" };
		if (result.error === "empty-name") return { kind: "error", name: "empty", folder: null };
		if (result.error === "duplicate") return { kind: "error", name: "duplicate", folder: null };
		return { kind: "error", name: null, folder: this.folderErrorOf(result) };
	}

	private renderDeleteConfirm(list: HTMLElement, item: { id: string; name: string }): void {
		const count = this.manager.countTasksUsing(this.kind, item.id);
		const confirm = list.createDiv({ cls: "task-time-tracker-log-edit-form" });

		confirm.createDiv({ text: item.name, cls: "task-time-tracker-log-task" });

		confirm.createEl("p", {
			text: t(count === 1 ? this.texts.deleteConfirmSingular : this.texts.deleteConfirmPlural, {
				count: String(count),
			}),
			cls: "task-time-tracker-log-edit-error",
		});

		const actions = confirm.createDiv({ cls: "task-time-tracker-log-edit-actions" });
		actions.createEl("button", { text: t("log.deleteTaskYes"), cls: "mod-warning" }).addEventListener("click", () => {
			void this.manager.remove(this.kind, item.id).then(() => {
				this.deleteConfirmId = null;
				this.render();
				this.callbacks.onChanged();
			});
		});
		actions.createEl("button", { text: t("log.cancel") }).addEventListener("click", () => {
			this.deleteConfirmId = null;
			this.render();
		});
	}
}
