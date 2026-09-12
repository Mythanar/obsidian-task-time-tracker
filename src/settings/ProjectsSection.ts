// settings/ProjectsSection.ts
// Settings > "Projects & clients": adding/removing projects and clients
// (base for future export adapters). Self-contained component (same
// spirit as TimeLogView.ts): manages its own transient state (active
// tab, form drafts, errors, pending delete confirmation) and re-renders
// itself on every change, without touching the rest of SettingsTab.ts.
// A new instance per opening of the Settings tab (see
// SettingsTab.ts#display) — losing the draft when Settings closes is
// acceptable, no other form in the plugin persists one either.

import { setIcon } from "obsidian";
import { t } from "../i18n";
import { Project } from "../types";
import { ProjectManager } from "../core/ProjectManager";

type ProjectsTab = "one" | "paste";
type OneByOneError = "empty" | "duplicate" | null;
type EditableField = "name" | "client";

// Extracted from the class (no state of its own) so the declarative
// Settings view (see SettingsTab.ts#getSettingDefinitions) can paint the
// banner in its own full-width row, separate from the row with the rest
// of the content — avoids both sharing a Setting's standard control
// column (broken layout, see the comment on render() below).
export function renderProjectsBanner(el: HTMLElement): void {
	const banner = el.createDiv({ cls: "task-time-tracker-projects-banner" });
	const icon = banner.createDiv({ cls: "task-time-tracker-projects-banner-icon" });
	setIcon(icon, "info");
	banner.createDiv({ text: t("settings.projects.banner"), cls: "task-time-tracker-projects-banner-text" });
}

export class ProjectsSection {
	private activeTab: ProjectsTab = "one";

	private nameDraft = "";
	private clientDraft = "";
	private oneByOneError: OneByOneError = null;

	private pasteDraft = "";
	private pasteError: { line: number; content: string } | null = null;

	private deleteConfirmId: string | null = null;

	// Inline per-row editing (Settings > Projects & clients): a single
	// editable field at a time across the whole list (never two rows or
	// two fields of the same row at once). editingField changes
	// reference on every startEdit()/cancelEdit()/saveEdit() — each
	// input's blur handler, captured by closure, compares against that
	// reference to tell a real blur (user leaves the field) apart from
	// one self-induced by our own render() on save or field change,
	// avoiding a duplicate cancelEdit(). See bindEditInputEvents().
	private editingField: { projectId: string; field: EditableField } | null = null;
	private editDraft = "";
	private editError: OneByOneError = null;

	constructor(
		private containerEl: HTMLElement,
		private manager: ProjectManager,
		// After removing a project in use, the tasks that had it assigned
		// go back to "no project" in the data model instantly (see
		// ProjectManager#removeProject), but the Historial may already
		// have cards rendered showing that project — this callback
		// refreshes those views so they don't stay stale until the next
		// external refresh.
		private onProjectsChanged: () => void,
		// The declarative Settings view (Obsidian >=1.13) paints the
		// banner in its own separate row (see renderProjectsBanner above)
		// so it doesn't share a column with this block; display() (the
		// classic view, <1.13) keeps using the default value and both go
		// together as always. The rest of the logic (saving, tabs,
		// editing) is identical in both cases — this only decides whether
		// this instance also draws the banner or not.
		private includeBanner = true,
	) {}

	render(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("task-time-tracker-projects");

		if (this.includeBanner) renderProjectsBanner(el);
		this.renderTabs(el);

		if (this.activeTab === "one") {
			this.renderOneByOneForm(el);
		} else {
			this.renderPasteListForm(el);
		}

		this.renderSavedList(el);
	}

	private renderTabs(el: HTMLElement): void {
		const tabs = el.createDiv({ cls: "task-time-tracker-log-datenav-mode task-time-tracker-projects-tabs" });

		const makeTab = (label: string, tab: ProjectsTab) => {
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

		// Container query (see styles.css): past a certain width of the
		// Settings panel (not the viewport — this block can live in the
		// sidebar or the center tab, see CLAUDE.md), the three fields
		// share a row; below it, each falls to its own full row. A single
		// wrapper for all three instead of grouping name separately from
		// client+button, so the breakpoint controls all three at once.
		const fields = form.createDiv({ cls: "task-time-tracker-projects-form-fields" });

		const nameInput = fields.createEl("input", { cls: "task-time-tracker-log-edit-input" });
		nameInput.type = "text";
		nameInput.placeholder = t("settings.projects.namePlaceholder");
		nameInput.value = this.nameDraft;
		nameInput.addEventListener("input", () => (this.nameDraft = nameInput.value));

		const clientInput = fields.createEl("input", { cls: "task-time-tracker-log-edit-input" });
		clientInput.type = "text";
		clientInput.placeholder = t("settings.projects.clientPlaceholder");
		clientInput.value = this.clientDraft;
		clientInput.addEventListener("input", () => (this.clientDraft = clientInput.value));

		const addBtn = fields.createEl("button", { text: t("settings.projects.addButton"), cls: "mod-cta" });
		addBtn.addEventListener("click", () => void this.handleAdd());

		if (this.oneByOneError) {
			const message = this.oneByOneError === "empty" ? "settings.projects.nameRequired" : "settings.projects.duplicateError";
			form.createEl("p", { text: t(message), cls: "task-time-tracker-log-edit-error" });
		}
	}

	private async handleAdd(): Promise<void> {
		const result = await this.manager.addProject(this.nameDraft, this.clientDraft);
		if (!result.ok) {
			this.oneByOneError = result.error === "empty-name" ? "empty" : "duplicate";
			this.render();
			return;
		}

		this.nameDraft = "";
		this.clientDraft = "";
		this.oneByOneError = null;
		this.render();
	}

	private renderPasteListForm(el: HTMLElement): void {
		const form = el.createDiv({ cls: "task-time-tracker-projects-form" });

		const textarea = form.createEl("textarea", { cls: "task-time-tracker-projects-textarea" });
		textarea.placeholder = t("settings.projects.importPlaceholder");
		textarea.value = this.pasteDraft;
		textarea.addEventListener("input", () => (this.pasteDraft = textarea.value));

		form.createEl("p", { text: t("settings.projects.pasteHelp"), cls: "task-time-tracker-projects-help" });

		if (this.pasteError) {
			form.createEl("p", {
				text: t("settings.projects.importError", {
					line: String(this.pasteError.line),
					content: this.pasteError.content,
				}),
				cls: "task-time-tracker-log-edit-error",
			});
		}

		const importBtn = form.createEl("button", {
			text: t("settings.projects.importButton"),
			cls: "mod-cta task-time-tracker-projects-import-btn",
		});
		importBtn.addEventListener("click", () => void this.handleImport());
	}

	private async handleImport(): Promise<void> {
		const result = await this.manager.importProjects(this.pasteDraft);
		if (!result.ok) {
			this.pasteError = { line: result.line, content: result.content };
			this.render();
			return;
		}

		this.pasteDraft = "";
		this.pasteError = null;
		this.render();
	}

	private renderSavedList(el: HTMLElement): void {
		const projects = this.manager.getProjects();

		el.createDiv({
			text: `${projects.length} ${t(projects.length === 1 ? "settings.projects.countSingular" : "settings.projects.countPlural")}`,
			cls: "task-time-tracker-projects-count",
		});

		const list = el.createDiv({ cls: "task-time-tracker-projects-list" });
		for (const project of projects) {
			if (this.deleteConfirmId === project.id) {
				this.renderDeleteConfirm(list, project);
			} else {
				this.renderProjectRow(list, project);
			}
		}
	}

	// Wide enough: name, client, and trash icon on one line. Narrow:
	// name on top, client+trash grouped below (see the container query
	// in styles.css) — that's why client and trash go together in their
	// own wrapper (task-time-tracker-projects-row-meta) instead of the
	// trash icon hanging loose off the row.
	private renderProjectRow(list: HTMLElement, project: Project): void {
		const row = list.createDiv({ cls: "task-time-tracker-projects-row" });
		const editingField = this.editingField?.projectId === project.id ? this.editingField.field : null;

		this.renderNameCell(row, project, editingField === "name");

		const meta = row.createDiv({ cls: "task-time-tracker-projects-row-meta" });
		this.renderClientCell(meta, project, editingField === "client");

		if (editingField) {
			const saveBtn = meta.createEl("button", {
				cls: "task-time-tracker-icon-btn clickable-icon task-time-tracker-projects-row-save",
			});
			setIcon(saveBtn, "check");
			saveBtn.setAttribute("aria-label", t("settings.projects.saveAriaLabel"));
			// preventDefault on mousedown: keeps the input from losing focus
			// (and thus firing its blur, which would cancel the edit) when
			// clicking this button — the save runs on the normal click that
			// follows.
			saveBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
			saveBtn.addEventListener("click", () => void this.saveEdit());
			return;
		}

		const deleteBtn = meta.createEl("button", {
			cls: "task-time-tracker-icon-btn clickable-icon task-time-tracker-projects-row-delete",
		});
		setIcon(deleteBtn, "trash-2");
		deleteBtn.setAttribute("aria-label", t("settings.projects.deleteAriaLabel"));
		deleteBtn.addEventListener("click", () => {
			// No tasks assigned (count 0): deleted directly, no dialog (no
			// real reason for the friction). With some assigned, the
			// confirmation below warns how many will silently become "no
			// project".
			const count = this.manager.countTasksUsingProject(project.id);
			if (count === 0) {
				void this.manager.removeProject(project.id).then(() => {
					this.render();
					this.onProjectsChanged();
				});
				return;
			}
			this.deleteConfirmId = project.id;
			this.render();
		});
	}

	private renderNameCell(row: HTMLElement, project: Project, editing: boolean): void {
		if (editing) {
			this.renderEditInput(row, project.name);
			return;
		}

		const span = row.createSpan({
			text: project.name,
			cls: "task-time-tracker-projects-row-name task-time-tracker-projects-row-editable",
		});
		// preventDefault on mousedown: if another field in the row were
		// being edited, this avoids its input's native blur (which would
		// fire its own cancelEdit) — the field switch is resolved wholly,
		// atomically, inside startEdit() when the click is received.
		span.addEventListener("mousedown", (evt) => evt.preventDefault());
		span.addEventListener("click", () => this.startEdit(project.id, "name", project.name));
	}

	private renderClientCell(meta: HTMLElement, project: Project, editing: boolean): void {
		if (editing) {
			this.renderEditInput(meta, project.client ?? "", t("settings.projects.clientPlaceholder"));
			return;
		}

		const hasClient = !!project.client;
		const span = meta.createSpan({
			text: project.client || t("settings.projects.clientPlaceholder"),
			cls: "task-time-tracker-projects-row-client task-time-tracker-projects-row-editable",
		});
		span.toggleClass("task-time-tracker-projects-row-client-empty", !hasClient);
		span.addEventListener("mousedown", (evt) => evt.preventDefault());
		span.addEventListener("click", () => this.startEdit(project.id, "client", project.client ?? ""));
	}

	// Input shared by both editable fields. Same help text as the
	// creation form (nameRequired / duplicateError), always visible
	// under the field when there's an error — never a tooltip (see
	// CLAUDE.md and the brief).
	private renderEditInput(container: HTMLElement, value: string, placeholder?: string): void {
		const wrapper = container.createDiv({ cls: "task-time-tracker-projects-row-edit-field" });
		const input = wrapper.createEl("input", { cls: "task-time-tracker-log-edit-input" });
		input.type = "text";
		if (placeholder) input.placeholder = placeholder;
		input.value = value;
		input.addEventListener("input", () => (this.editDraft = input.value));
		this.bindEditInputEvents(input);
		input.focus();
		input.select();

		if (this.editError) {
			const message = this.editError === "empty" ? "settings.projects.nameRequired" : "settings.projects.duplicateError";
			wrapper.createEl("p", { text: t(message), cls: "task-time-tracker-log-edit-error" });
		}
	}

	// Enter saves (same as the "Save" button), Esc cancels without
	// saving. Blur only cancels if it's still the same editing
	// "session" as when this input was created — see the comment next
	// to editingField about why that reference comparison is needed
	// instead of a simple "editingField !== null".
	private bindEditInputEvents(input: HTMLInputElement): void {
		const session = this.editingField;
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void this.saveEdit();
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				this.cancelEdit();
			}
		});
		input.addEventListener("blur", () => {
			if (this.editingField === session) this.cancelEdit();
		});
	}

	private startEdit(projectId: string, field: EditableField, currentValue: string): void {
		this.editingField = { projectId, field };
		this.editDraft = currentValue;
		this.editError = null;
		this.render();
	}

	private cancelEdit(): void {
		if (!this.editingField) return;
		this.editingField = null;
		this.editError = null;
		this.render();
	}

	private async saveEdit(): Promise<void> {
		const editing = this.editingField;
		if (!editing) return;

		const project = this.manager.getProjects().find((p) => p.id === editing.projectId);
		if (!project) {
			this.editingField = null;
			this.render();
			return;
		}

		const name = editing.field === "name" ? this.editDraft : project.name;
		const client = editing.field === "client" ? this.editDraft : (project.client ?? "");

		const result = await this.manager.updateProject(editing.projectId, name, client);
		if (!result.ok) {
			this.editError = result.error === "empty-name" ? "empty" : "duplicate";
			// New reference (same field): invalidates the "session" the
			// previous input captured, so its blur (fired by the re-render
			// below) doesn't cancel the edit we just reopened with the
			// error visible.
			this.editingField = { ...editing };
			this.render();
			return;
		}

		this.editingField = null;
		this.editError = null;
		this.render();
		this.onProjectsChanged();
	}

	private renderDeleteConfirm(list: HTMLElement, project: Project): void {
		const count = this.manager.countTasksUsingProject(project.id);
		const confirm = list.createDiv({ cls: "task-time-tracker-log-edit-form" });

		confirm.createDiv({
			text: project.client ? `${project.name} — ${project.client}` : project.name,
			cls: "task-time-tracker-log-task",
		});

		confirm.createEl("p", {
			text: t(count === 1 ? "settings.projects.deleteConfirmSingular" : "settings.projects.deleteConfirmPlural", {
				count: String(count),
			}),
			cls: "task-time-tracker-log-edit-error",
		});

		const actions = confirm.createDiv({ cls: "task-time-tracker-log-edit-actions" });
		actions.createEl("button", { text: t("log.deleteTaskYes"), cls: "mod-warning" }).addEventListener("click", () => {
			void this.manager.removeProject(project.id).then(() => {
				this.deleteConfirmId = null;
				this.render();
				this.onProjectsChanged();
			});
		});
		actions.createEl("button", { text: t("log.cancel") }).addEventListener("click", () => {
			this.deleteConfirmId = null;
			this.render();
		});
	}
}
