// ui/ProjectPickerList.ts
// "Project picker list" — componente compartido (buscador + lista plana de
// proyectos/clientes + seleccion), extraido del selector de Proyecto del
// modal "Editar tarea" para reutilizarlo tambien en el filtro por proyecto
// del header del Historial (ver TimeLogView.ts#renderProjectFilter y
// EditTaskModal.ts). Vive siempre dentro de un popover flotante (ver
// openProjectPickerPopover mas abajo): ningun caller lo monta suelto en
// linea.

import { setIcon } from "obsidian";
import { t } from "../i18n";
import { Project } from "../types";
import { positionPopover } from "./positionPopover";

export interface ProjectPickerListOptions {
	// null: proyectos aun no disponibles, se muestra el skeleton (ver
	// renderSkeleton()). Ningun caller actual pasa null hoy (ProjectManager
	// resuelve de forma sincrona), pero el componente lo soporta como parte
	// de su contrato.
	projects: Project[] | null;
	selectedId: string | null;
	showClearOption: boolean;
	// Fila fija "No project" para el filtro del header (ver
	// TimeLogView.ts#renderProjectFilter): visualmente identica a la fila
	// "Sin proyecto" de showClearOption, pero con semantica distinta (
	// filtrar por ausencia de proyecto, no asignarla) y por eso con su
	// propio estado de seleccion, independiente de selectedId — en el
	// filtro selectedId===null es ambiguo entre "sin filtro" y "filtro No
	// project", asi que ese estado se resuelve aparte. Mutuamente
	// excluyente con showClearOption en la practica (ningun caller activa
	// las dos), aunque el componente no lo impone.
	showNoProjectFilterOption?: boolean;
	noProjectFilterSelected?: boolean;
	onSelect: (projectId: string | null) => void;
}

const SKELETON_ROW_COUNT = 3;

export class ProjectPickerList {
	private searchInput: HTMLInputElement | null = null;
	private listEl: HTMLElement | null = null;
	private query = "";

	constructor(
		private containerEl: HTMLElement,
		private options: ProjectPickerListOptions,
	) {}

	render(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("task-time-tracker-project-picker");

		this.searchInput = el.createEl("input", { cls: "task-time-tracker-project-picker-search" });
		this.searchInput.type = "text";
		this.searchInput.placeholder = t("log.projectPicker.searchPlaceholder");
		this.searchInput.value = this.query;
		this.searchInput.addEventListener("input", () => {
			this.query = this.searchInput?.value ?? "";
			this.renderList();
		});

		this.listEl = el.createDiv({ cls: "task-time-tracker-project-picker-list" });
		this.renderList();
	}

	// Foco automatico al montar (ver acceptance criteria) — separado de
	// render() para que el caller lo dispare solo una vez el popover ya
	// esta posicionado y visible (ver openProjectPickerPopover).
	focusSearch(): void {
		this.searchInput?.focus();
	}

	private renderList(): void {
		const listEl = this.listEl;
		if (!listEl) return;
		listEl.empty();

		const { projects, selectedId, showClearOption, showNoProjectFilterOption, noProjectFilterSelected, onSelect } =
			this.options;

		if (projects === null) {
			for (let i = 0; i < SKELETON_ROW_COUNT; i++) {
				listEl.createDiv({ cls: "task-time-tracker-project-picker-row task-time-tracker-project-picker-skeleton" });
			}
			return;
		}

		// "Sin proyecto" queda fuera del orden alfabetico y del filtro de
		// busqueda: es una accion fija, no un proyecto real que buscar.
		if (showClearOption) {
			this.renderRow(listEl, {
				label: t("log.editModalNoProject"),
				clientName: null,
				selected: selectedId === null,
				isClear: true,
				onClick: () => onSelect(null),
			});
		}

		if (showNoProjectFilterOption) {
			this.renderRow(listEl, {
				label: t("log.editModalNoProject"),
				clientName: null,
				selected: !!noProjectFilterSelected,
				isClear: true,
				onClick: () => onSelect(null),
			});
		}

		const query = this.query.trim().toLowerCase();
		const matches = (
			query
				? projects.filter((p) => p.name.toLowerCase().includes(query) || (p.client ?? "").toLowerCase().includes(query))
				: projects
		)
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name));

		if (query && matches.length === 0) {
			listEl.createDiv({
				text: t("log.projectPicker.noMatches", { query: this.query.trim() }),
				cls: "task-time-tracker-project-picker-empty",
			});
			return;
		}

		for (const project of matches) {
			this.renderRow(listEl, {
				label: project.name,
				clientName: project.client ?? null,
				selected: project.id === selectedId,
				isClear: false,
				onClick: () => onSelect(project.id),
			});
		}
	}

	private renderRow(
		listEl: HTMLElement,
		row: { label: string; clientName: string | null; selected: boolean; isClear: boolean; onClick: () => void },
	): void {
		const rowEl = listEl.createDiv({ cls: "task-time-tracker-project-picker-row" });
		rowEl.toggleClass("task-time-tracker-project-picker-row-clear", row.isClear);
		rowEl.toggleClass("is-selected", row.selected);

		// Columna de ancho fijo siempre presente (con o sin check dentro):
		// mantiene la misma altura/alineacion en todas las filas, con o sin
		// seleccion activa.
		const check = rowEl.createSpan({ cls: "task-time-tracker-project-picker-check" });
		if (row.selected) setIcon(check, "check");

		// Dos lineas (nombre arriba, cliente debajo si lo hay): revertido
		// tras QA con datos reales (agosto 2026) — el formato de una linea
		// ("nombre · cliente") hacia desaparecer el proyecto entero con
		// clientes de nombre largo, y truncaba ambos campos incluso en el
		// caso normal. Cada linea trunca de forma independiente (ver CSS),
		// asi que el nombre del proyecto se ve completo o truncado sin
		// depender de lo largo que sea el cliente, y viceversa.
		const label = rowEl.createDiv({ cls: "task-time-tracker-project-picker-label" });
		label.createDiv({ text: row.label, cls: "task-time-tracker-project-picker-name" });
		if (row.clientName) {
			label.createDiv({ text: row.clientName, cls: "task-time-tracker-project-picker-client" });
		}

		rowEl.addEventListener("click", row.onClick);
	}
}

export interface ProjectPickerPopoverOptions {
	anchorEl: HTMLElement;
	projects: Project[] | null;
	selectedId: string | null;
	showClearOption: boolean;
	showNoProjectFilterOption?: boolean;
	noProjectFilterSelected?: boolean;
	onSelect: (projectId: string | null) => void;
	// Notifica al caller cuando el popover se cierra, por el motivo que
	// sea (seleccion, click fuera, Escape). EditTaskModal lo usa para
	// soltar su propio guard anti-cierre mientras el popover esta abierto
	// (ver el comentario junto a outsideMousedownGuardUntil en
	// EditTaskModal.ts) — el popover vive fuera de modalEl (appendeado a
	// document.body para poder posicionarse con position: fixed sin
	// depender del contenedor padre), asi que sin ese guard interactuar
	// con el (buscar, clicar una fila) se veria como un click "fuera del
	// modal" y lo cerraria de golpe.
	onClose?: () => void;
}

// Como mucho un popover de este componente abierto a la vez en toda la
// app (un unico picker de proyecto visible en cada momento, igual que el
// timer activo unico del MVP) — abrir uno nuevo cierra el anterior.
let activePopover: { anchorEl: HTMLElement; close: () => void } | null = null;

export function openProjectPickerPopover(options: ProjectPickerPopoverOptions): void {
	// Clic en el mismo boton que ya tiene su popover abierto: lo cierra
	// (toggle) en vez de abrir uno identico encima.
	if (activePopover && activePopover.anchorEl === options.anchorEl) {
		activePopover.close();
		return;
	}
	activePopover?.close();

	const popoverEl = document.body.createDiv({ cls: "task-time-tracker-project-picker-popover" });

	const list = new ProjectPickerList(popoverEl, {
		projects: options.projects,
		selectedId: options.selectedId,
		showClearOption: options.showClearOption,
		showNoProjectFilterOption: options.showNoProjectFilterOption,
		noProjectFilterSelected: options.noProjectFilterSelected,
		onSelect: (id) => {
			options.onSelect(id);
			close();
		},
	});
	list.render();
	positionPopover(popoverEl, options.anchorEl);
	list.focusSearch();

	const onOutsideMousedown = (evt: MouseEvent) => {
		const target = evt.target as Node;
		if (!popoverEl.contains(target) && !options.anchorEl.contains(target)) close();
	};
	const onKeydown = (evt: KeyboardEvent) => {
		if (evt.key === "Escape") close();
	};

	function close(): void {
		document.removeEventListener("mousedown", onOutsideMousedown, true);
		document.removeEventListener("keydown", onKeydown, true);
		popoverEl.remove();
		activePopover = null;
		options.onClose?.();
	}

	// El mousedown del propio clic que abrio este popover ya ocurrio antes
	// de que este codigo se ejecute (mousedown -> mouseup -> click), asi
	// que registrar el listener ahora no lo cierra de inmediato consigo
	// mismo.
	document.addEventListener("mousedown", onOutsideMousedown, true);
	document.addEventListener("keydown", onKeydown, true);

	activePopover = { anchorEl: options.anchorEl, close };
}
