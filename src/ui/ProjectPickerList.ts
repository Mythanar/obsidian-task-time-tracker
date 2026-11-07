// ui/ProjectPickerList.ts
// "Project picker list" — shared component (search box + flat list of
// projects or clients + selection), used by the Client and Project
// selectors in the "Edit task" modal and by the Historial header's
// project filter (see TimeLogView.ts#renderProjectFilter and
// EditTaskModal.ts). One list kind per instance (kind), one line per
// row. Always lives inside a floating popover (see
// openProjectPickerPopover below): no caller mounts it standalone inline.

import { Modal, Platform, Scope, setIcon } from "obsidian";
import { t, TranslationKey } from "../i18n";
import { ListKind } from "../core/ProjectManager";
import { positionPopover } from "./positionPopover";

export interface PickerItem {
	id: string;
	name: string;
}

// Texts per list kind.
const LABELS: Record<ListKind, { none: TranslationKey; search: TranslationKey }> = {
	project: { none: "log.editModalNoProject", search: "log.projectPicker.searchPlaceholder" },
	client: { none: "log.editModalNoClient", search: "log.clientPicker.searchPlaceholder" },
};

export interface ProjectPickerListOptions {
	kind: ListKind;
	// null: items not yet available, the skeleton is shown (see
	// renderSkeleton()). No current caller passes null today
	// (ProjectManager resolves synchronously), but the component supports
	// it as part of its contract.
	items: PickerItem[] | null;
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
		this.searchInput.placeholder = t(LABELS[this.options.kind].search);
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
	// already positioned and visible, and only on desktop (see
	// openProjectPickerPopover).
	focusSearch(): void {
		this.searchInput?.focus();
	}

	private renderList(): void {
		const listEl = this.listEl;
		if (!listEl) return;
		listEl.empty();

		const { kind, items, selectedId, showClearOption, showNoProjectFilterOption, noProjectFilterSelected, onSelect } =
			this.options;
		const noneLabel = t(LABELS[kind].none);

		if (items === null) {
			for (let i = 0; i < SKELETON_ROW_COUNT; i++) {
				listEl.createDiv({ cls: "task-time-tracker-project-picker-row task-time-tracker-project-picker-skeleton" });
			}
			return;
		}

		// "No project" stays outside alphabetical order and the search
		// filter: it's a fixed action, not a real project to search for.
		if (showClearOption) {
			this.renderRow(listEl, {
				label: noneLabel,
				selected: selectedId === null,
				isClear: true,
				onClick: () => onSelect(null),
			});
		}

		if (showNoProjectFilterOption) {
			this.renderRow(listEl, {
				label: noneLabel,
				selected: !!noProjectFilterSelected,
				isClear: true,
				onClick: () => onSelect(null),
			});
		}

		const query = this.query.trim().toLowerCase();
		const matches = (query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items)
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name));

		if (query && matches.length === 0) {
			listEl.createDiv({
				text: t("log.projectPicker.noMatches", { query: this.query.trim() }),
				cls: "task-time-tracker-project-picker-empty",
			});
			return;
		}

		for (const item of matches) {
			this.renderRow(listEl, {
				label: item.name,
				selected: item.id === selectedId,
				isClear: false,
				onClick: () => onSelect(item.id),
			});
		}
	}

	private renderRow(
		listEl: HTMLElement,
		row: { label: string; selected: boolean; isClear: boolean; onClick: () => void },
	): void {
		const rowEl = listEl.createDiv({ cls: "task-time-tracker-project-picker-row" });
		rowEl.toggleClass("task-time-tracker-project-picker-row-clear", row.isClear);
		rowEl.toggleClass("is-selected", row.selected);

		// Fixed-width column always present (with or without a check
		// inside): keeps the same height/alignment across all rows, with
		// or without an active selection.
		const check = rowEl.createSpan({ cls: "task-time-tracker-project-picker-check" });
		if (row.selected) setIcon(check, "check");

		// One line: projects no longer carry a client (format 2).
		const label = rowEl.createDiv({ cls: "task-time-tracker-project-picker-label" });
		label.createDiv({ text: row.label, cls: "task-time-tracker-project-picker-name" });

		rowEl.addEventListener("click", row.onClick);
	}
}

export interface ProjectPickerPopoverOptions {
	anchorEl: HTMLElement;
	kind: ListKind;
	items: PickerItem[] | null;
	selectedId: string | null;
	showClearOption: boolean;
	showNoProjectFilterOption?: boolean;
	noProjectFilterSelected?: boolean;
	onSelect: (projectId: string | null) => void;
	// The modal it's opened from, if any. The popover is then attached to
	// the modal's own element (modalEl) instead of document.body: Obsidian
	// keeps focus inside an open modal, so a search box outside it loses
	// focus to the modal's first button on every keystroke. Being inside
	// modalEl also means clicks on the popover don't count as clicks
	// outside the modal. position: fixed still anchors it to the window.
	// Escape gets a keymap scope on top of the modal's, so it closes only
	// the popover, not the modal.
	modal?: Modal;
}

// At most one popover of this component open at a time across the whole
// app (a single project picker visible at any moment, same as the MVP's
// single active timer) — opening a new one closes the previous one.
let activePopover: { anchorEl: HTMLElement; close: () => void } | null = null;

// For a modal that closes while its popover is still open: releases the
// popover's Escape scope and listeners along with it.
export function closeProjectPickerPopover(): void {
	activePopover?.close();
}

export function openProjectPickerPopover(options: ProjectPickerPopoverOptions): void {
	// Click on the same button that already has its popover open: closes
	// it (toggle) instead of opening an identical one on top.
	if (activePopover && activePopover.anchorEl === options.anchorEl) {
		activePopover.close();
		return;
	}
	activePopover?.close();

	const { modal } = options;
	const popoverEl = (modal?.modalEl ?? document.body).createDiv({ cls: "task-time-tracker-project-picker-popover" });

	const list = new ProjectPickerList(popoverEl, {
		kind: options.kind,
		items: options.items,
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
	// No automatic focus in the mobile app (phones and tablets): focusing
	// the search box opens the on-screen keyboard, which covers most of
	// the list. The full list stays visible and the keyboard only opens
	// when the user taps the search box. Desktop keeps the focus, so
	// typing to filter works right away.
	if (!Platform.isMobile) list.focusSearch();

	const onOutsideMousedown = (evt: MouseEvent) => {
		const target = evt.target as Node;
		if (!popoverEl.contains(target) && !options.anchorEl.contains(target)) close();
	};
	// Escape hands focus back to the button that opened the popover.
	const closeOnEscape = () => {
		close();
		options.anchorEl.focus();
	};
	const onKeydown = (evt: KeyboardEvent) => {
		if (evt.key === "Escape") closeOnEscape();
	};
	let scope: Scope | null = null;
	if (modal) {
		scope = new Scope(modal.scope);
		scope.register([], "Escape", () => {
			closeOnEscape();
			return false;
		});
		modal.app.keymap.pushScope(scope);
	}

	let closed = false;
	function close(): void {
		if (closed) return;
		closed = true;
		if (scope) modal?.app.keymap.popScope(scope);
		document.removeEventListener("mousedown", onOutsideMousedown, true);
		document.removeEventListener("keydown", onKeydown, true);
		popoverEl.remove();
		activePopover = null;
	}

	// The mousedown of the very click that opened this popover already
	// happened before this code runs (mousedown -> mouseup -> click), so
	// registering the listener now doesn't immediately close it on
	// itself.
	document.addEventListener("mousedown", onOutsideMousedown, true);
	document.addEventListener("keydown", onKeydown, true);

	activePopover = { anchorEl: options.anchorEl, close };
}
