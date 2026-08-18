// settings/ProjectsSection.ts
// Fase 8 — Settings > "Projects & clients": alta/baja de proyectos y
// clientes (base para futuros adapters de exportacion). Componente
// autocontenido (mismo espiritu que TimeLogView.ts): gestiona su propio
// estado transitorio (pestaña activa, borradores de formulario, errores,
// confirmacion de borrado pendiente) y se re-renderiza a si mismo en cada
// cambio, sin tocar el resto de SettingsTab.ts. Una instancia nueva por
// cada apertura de la pestaña de Settings (ver SettingsTab.ts#display) —
// perder el borrador al cerrar Settings es aceptable, ningun otro
// formulario del plugin lo persiste tampoco.

import { setIcon } from "obsidian";
import { t } from "../i18n";
import { Project } from "../types";
import { ProjectManager } from "../core/ProjectManager";

type ProjectsTab = "one" | "paste";
type OneByOneError = "empty" | "duplicate" | null;
type EditableField = "name" | "client";

export class ProjectsSection {
	private activeTab: ProjectsTab = "one";

	private nameDraft = "";
	private clientDraft = "";
	private oneByOneError: OneByOneError = null;

	private pasteDraft = "";
	private pasteError: { line: number; content: string } | null = null;

	private deleteConfirmId: string | null = null;

	// Edicion inline por fila (Settings > Projects & clients): un unico
	// campo editable a la vez en todo el listado (nunca dos filas ni dos
	// campos de la misma fila simultaneos). editingField cambia de
	// referencia en cada startEdit()/cancelEdit()/saveEdit() — el blur
	// handler de cada input capturado por closure compara contra esa
	// referencia para distinguir un blur real (usuario sale del campo)
	// de un blur autoinducido por nuestro propio render() al guardar o
	// cambiar de campo, evitando un cancelEdit() duplicado. Ver
	// bindEditInputEvents().
	private editingField: { projectId: string; field: EditableField } | null = null;
	private editDraft = "";
	private editError: OneByOneError = null;

	constructor(
		private containerEl: HTMLElement,
		private manager: ProjectManager,
		// Tras borrar un proyecto en uso, las tareas que lo tenian asignado
		// vuelven a "sin proyecto" en el modelo de datos al instante (ver
		// ProjectManager#removeProject), pero el Historial ya puede tener
		// tarjetas renderizadas mostrando ese proyecto — este callback
		// refresca esas vistas para que no se queden desactualizadas hasta
		// el proximo refresco externo.
		private onProjectsChanged: () => void,
	) {}

	render(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("task-time-tracker-projects");

		this.renderBanner(el);
		this.renderTabs(el);

		if (this.activeTab === "one") {
			this.renderOneByOneForm(el);
		} else {
			this.renderPasteListForm(el);
		}

		this.renderSavedList(el);
	}

	private renderBanner(el: HTMLElement): void {
		const banner = el.createDiv({ cls: "task-time-tracker-projects-banner" });
		const icon = banner.createDiv({ cls: "task-time-tracker-projects-banner-icon" });
		setIcon(icon, "info");
		banner.createDiv({ text: t("settings.projects.banner"), cls: "task-time-tracker-projects-banner-text" });
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

		// Container query (ver styles.css): a partir de cierto ancho del
		// panel de Settings (no del viewport — este bloque puede vivir en
		// sidebar o en tab central, ver CLAUDE.md), los tres campos
		// comparten fila; por debajo, cada uno cae en su propia fila
		// completa. Un unico wrapper para los tres en vez de agrupar
		// nombre aparte de cliente+boton, para que el punto de corte
		// controle los tres a la vez.
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

	// Ancho suficiente: nombre, cliente y papelera en una linea. Ancho
	// reducido: nombre arriba, cliente+papelera agrupados debajo (ver
	// container query en styles.css) — por eso cliente y papelera van
	// juntos en su propio wrapper (task-time-tracker-projects-row-meta) en
	// vez de que la papelera cuelgue suelta del row.
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
			// preventDefault en mousedown: evita que el input pierda el foco
			// (y por tanto su blur, que cancelaria la edicion) al clicar este
			// boton — el guardado se ejecuta en el click normal que sigue.
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
			// Sin tareas asignadas (conteo 0): se borra directo, sin dialogo
			// (fricción sin motivo real). Con alguna asignada, la confirmacion
			// de abajo avisa cuantas se quedaran "sin proyecto" en silencio.
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
		// preventDefault en mousedown: si otro campo de la fila estuviera en
		// edicion, evita el blur nativo de su input (que dispararia su
		// propio cancelEdit) — el cambio de campo se resuelve entero, de
		// forma atomica, dentro de startEdit() al recibir el click.
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

	// Input compartido por ambos campos editables. Mismo texto de ayuda
	// que el formulario de alta (nameRequired / duplicateError), siempre
	// visible bajo el campo cuando hay error — nunca tooltip (ver
	// CLAUDE.md y brief).
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

	// Enter guarda (igual que el boton "Guardar"), Esc cancela sin
	// guardar. El blur solo cancela si sigue siendo el mismo "session" de
	// edicion que cuando se creo este input — ver el comentario junto a
	// editingField sobre por que hace falta esa comparacion por
	// referencia en vez de un simple "editingField !== null".
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
			// Referencia nueva (mismo campo): invalida el "session" que
			// capturo el input anterior, para que su blur (disparado por el
			// re-render de abajo) no cancele la edicion que acabamos de
			// reabrir con el error visible.
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
