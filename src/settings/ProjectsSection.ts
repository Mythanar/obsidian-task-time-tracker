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

import { setIcon } from "obsidian";
import { t, TranslationKey } from "../i18n";
import { ListKind, ProjectManager } from "../core/ProjectManager";

type ListTab = "one" | "paste";
type NameError = "empty" | "duplicate" | null;

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
	constructor(
		private containerEl: HTMLElement,
		private manager: ProjectManager,
		// After removing or renaming an item in use, the Historial may
		// already have cards rendered showing it — this callback refreshes
		// those views so they don't stay stale until the next external
		// refresh.
		private onProjectsChanged: () => void,
		// The declarative Settings view (Obsidian >=1.13) paints the
		// banner in its own separate row (see renderProjectsBanner above)
		// so it doesn't share a column with this block; display() (the
		// classic view, <1.13) keeps using the default value and both go
		// together as always.
		private includeBanner = true,
	) {}

	render(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("task-time-tracker-projects");

		if (this.includeBanner) renderProjectsBanner(el);

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
	private addError: NameError = null;

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
	private editing: { id: string } | null = null;
	private editDraft = "";
	private editError: NameError = null;

	private texts: ListTexts;

	constructor(
		private el: HTMLElement,
		private kind: ListKind,
		private manager: ProjectManager,
		private callbacks: { onChanged: () => void; onLocked: () => void },
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
				row.createSpan({ text: item.name, cls: "task-time-tracker-projects-row-name" });
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
				void this.handleAdd();
			}
		});

		const addBtn = fields.createEl("button", { text: t("settings.projects.addButton"), cls: "mod-cta" });
		addBtn.addEventListener("click", () => void this.handleAdd());

		if (this.addError) {
			errorEl = form.createEl("p", { text: t(this.errorKey(this.addError)), cls: "task-time-tracker-log-edit-error" });
		}
	}

	private errorKey(error: "empty" | "duplicate"): TranslationKey {
		return error === "empty" ? this.texts.nameRequired : this.texts.duplicate;
	}

	private async handleAdd(): Promise<void> {
		const result = await this.manager.add(this.kind, this.nameDraft);
		if (!result.ok && result.error === "newer-format") {
			this.callbacks.onLocked();
			return;
		}
		if (!result.ok) {
			this.addError = result.error === "empty-name" ? "empty" : "duplicate";
			this.render();
			return;
		}

		this.nameDraft = "";
		this.addError = null;
		this.render();
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

		// The name itself is still clickable to edit, as before the pencil.
		const name = row.createSpan({
			text: item.name,
			cls: "task-time-tracker-projects-row-name task-time-tracker-projects-row-editable",
		});
		name.addEventListener("mousedown", (evt) => evt.preventDefault());
		name.addEventListener("click", () => this.startEdit(item.id, item.name));

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

	// Same help text as the creation form (nameRequired / duplicate),
	// always visible under the field when there's an error — never a
	// tooltip.
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
		this.bindEditInputEvents(input);
		input.focus();
		input.select();

		if (this.editError) {
			errorEl = wrapper.createEl("p", { text: t(this.errorKey(this.editError)), cls: "task-time-tracker-log-edit-error" });
		}
	}

	// Enter saves (same as the check button), Esc cancels without saving.
	// Blur only cancels if it's still the same editing "session" as when
	// this input was created — see the comment next to `editing`.
	private bindEditInputEvents(input: HTMLInputElement): void {
		const session = this.editing;
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
			if (this.editing === session) this.cancelEdit();
		});
	}

	private startEdit(id: string, currentName: string): void {
		this.editing = { id };
		this.editDraft = currentName;
		this.editError = null;
		this.render();
	}

	private cancelEdit(): void {
		if (!this.editing) return;
		this.editing = null;
		this.editError = null;
		this.render();
	}

	private async saveEdit(): Promise<void> {
		const editing = this.editing;
		if (!editing) return;

		const result = await this.manager.rename(this.kind, editing.id, this.editDraft);
		if (!result.ok && result.error === "newer-format") {
			this.callbacks.onLocked();
			return;
		}
		if (!result.ok) {
			this.editError = result.error === "empty-name" ? "empty" : "duplicate";
			// New reference: invalidates the "session" the previous input
			// captured, so its blur (fired by the re-render below) doesn't
			// cancel the edit we just reopened with the error visible.
			this.editing = { ...editing };
			this.render();
			return;
		}

		this.editing = null;
		this.editError = null;
		this.render();
		this.callbacks.onChanged();
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
