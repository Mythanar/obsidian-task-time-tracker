// ui/ProjectPickerList.ts
// "Project picker list" — shared component (search box + flat list of
// projects/clients + selection), extracted from the Project selector in
// the "Edit task" modal to also reuse it in the Historial header's
// project filter (see TimeLogView.ts#renderProjectFilter and
// EditTaskModal.ts). Always lives inside a floating popover (see
// openProjectPickerPopover below): no caller mounts it standalone inline.

import { setIcon } from "obsidian";
import { t } from "../i18n";
import { Project } from "../types";
import { positionPopover } from "./positionPopover";

export interface ProjectPickerListOptions {
	// null: projects not yet available, the skeleton is shown (see
	// renderSkeleton()). No current caller passes null today
	// (ProjectManager resolves synchronously), but the component supports
	// it as part of its contract.
	projects: Project[] | null;
	selectedId: string | null;
	showClearOption: boolean;
	// Fixed "No project" row for the header filter (see
	// TimeLogView.ts#renderProjectFilter): visually identical to
	// showClearOption's "No project" row, but with different semantics
	// (filtering by absence of a project, not assigning it) and so with
	// its own selection state, independent of selectedId — in the filter,
	// selectedId===null is ambiguous between "no filter" and "No project
	// filter", so that state is resolved separately. Mutually exclusive
	// with showClearOption in practice (no caller enables both), though
	// the component doesn't enforce it.
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

	// Automatic focus on mount (see acceptance criteria) — separate from
	// render() so the caller only triggers it once the popover is
	// already positioned and visible (see openProjectPickerPopover).
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

		// "No project" stays outside alphabetical order and the search
		// filter: it's a fixed action, not a real project to search for.
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

		// Fixed-width column always present (with or without a check
		// inside): keeps the same height/alignment across all rows, with
		// or without an active selection.
		const check = rowEl.createSpan({ cls: "task-time-tracker-project-picker-check" });
		if (row.selected) setIcon(check, "check");

		// Two lines (name on top, client below if any) rather than one
		// "name · client" line (see docs/DECISIONS.md): each line
		// truncates independently (see CSS), so the project name shows
		// in full or truncated without depending on how long the client
		// name is, and vice versa.
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
	// Notifies the caller when the popover closes, for whatever reason
	// (selection, outside click, Escape). EditTaskModal uses it to
	// release its own anti-close guard while the popover is open (see
	// the comment next to outsideMousedownGuardUntil in
	// EditTaskModal.ts) — the popover lives outside modalEl (appended to
	// document.body so it can be positioned with position: fixed without
	// depending on the parent container), so without that guard
	// interacting with it (searching, clicking a row) would look like a
	// click "outside the modal" and close it abruptly.
	onClose?: () => void;
}

// At most one popover of this component open at a time across the whole
// app (a single project picker visible at any moment, same as the MVP's
// single active timer) — opening a new one closes the previous one.
let activePopover: { anchorEl: HTMLElement; close: () => void } | null = null;

export function openProjectPickerPopover(options: ProjectPickerPopoverOptions): void {
	// Click on the same button that already has its popover open: closes
	// it (toggle) instead of opening an identical one on top.
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

	// The mousedown of the very click that opened this popover already
	// happened before this code runs (mousedown -> mouseup -> click), so
	// registering the listener now doesn't immediately close it on
	// itself.
	document.addEventListener("mousedown", onOutsideMousedown, true);
	document.addEventListener("keydown", onKeydown, true);

	activePopover = { anchorEl: options.anchorEl, close };
}
