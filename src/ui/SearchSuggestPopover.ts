// ui/SearchSuggestPopover.ts
// Suggestion list under the Historial's search field (see
// TimeLogView.ts#renderDateNav). An aid, not a constraint: nothing is
// highlighted until the user moves with the arrow keys, so Enter on its
// own searches the typed text as-is. Same floating look and anchoring as
// the project picker (positionPopover.ts), but the input stays in the
// header — this is only the list, and focus never leaves the input
// (rows use mousedown.preventDefault so clicking one doesn't blur it).

import { SearchSuggestion } from "../core/TaskSearch";
import { positionPopover } from "./positionPopover";

let nextListId = 0;

export class SearchSuggestPopover {
	private popoverEl: HTMLElement | null = null;
	private suggestions: SearchSuggestion[] = [];
	private highlighted = -1;
	private readonly listId = `task-time-tracker-search-suggest-${nextListId++}`;
	private readonly onOutsideMousedown = (evt: MouseEvent) => {
		const target = evt.target as Node;
		if (this.popoverEl?.contains(target) || this.inputEl.contains(target)) return;
		this.hide();
	};

	constructor(
		private inputEl: HTMLInputElement,
		private onPick: (suggestion: SearchSuggestion) => void,
	) {
		inputEl.setAttribute("role", "combobox");
		inputEl.setAttribute("aria-autocomplete", "list");
		inputEl.setAttribute("aria-controls", this.listId);
		inputEl.setAttribute("aria-expanded", "false");
	}

	isOpen(): boolean {
		return this.popoverEl !== null;
	}

	update(suggestions: SearchSuggestion[]): void {
		this.suggestions = suggestions;
		this.highlighted = -1;
		if (suggestions.length === 0) {
			this.hide();
			return;
		}
		if (!this.popoverEl) {
			this.popoverEl = document.body.createDiv({
				cls: "task-time-tracker-project-picker-popover task-time-tracker-search-suggest",
			});
			this.popoverEl.id = this.listId;
			this.popoverEl.setAttribute("role", "listbox");
			document.addEventListener("mousedown", this.onOutsideMousedown, true);
			this.inputEl.setAttribute("aria-expanded", "true");
		}
		this.renderRows();
		positionPopover(this.popoverEl, this.inputEl, Math.max(300, this.inputEl.getBoundingClientRect().width));
	}

	// -1/+1 from the arrow keys. Wraps around, and passes through "nothing
	// highlighted" so the user can get back to plain-text Enter.
	move(delta: number): void {
		if (!this.popoverEl) return;
		const count = this.suggestions.length;
		const next = this.highlighted + delta;
		this.highlighted = next < -1 ? count - 1 : next >= count ? -1 : next;
		this.renderRows();
	}

	getHighlighted(): SearchSuggestion | null {
		return this.suggestions[this.highlighted] ?? null;
	}

	hide(): void {
		if (!this.popoverEl) return;
		document.removeEventListener("mousedown", this.onOutsideMousedown, true);
		this.popoverEl.remove();
		this.popoverEl = null;
		this.highlighted = -1;
		this.inputEl.setAttribute("aria-expanded", "false");
		this.inputEl.removeAttribute("aria-activedescendant");
	}

	private renderRows(): void {
		const popoverEl = this.popoverEl;
		if (!popoverEl) return;
		popoverEl.empty();

		this.suggestions.forEach((suggestion, index) => {
			const rowEl = popoverEl.createDiv({ cls: "task-time-tracker-search-suggest-row" });
			rowEl.id = `${this.listId}-${index}`;
			rowEl.setAttribute("role", "option");
			const isHighlighted = index === this.highlighted;
			rowEl.toggleClass("is-highlighted", isHighlighted);
			rowEl.setAttribute("aria-selected", String(isHighlighted));

			const textEl = rowEl.createSpan({ cls: "task-time-tracker-search-suggest-text" });
			const range = suggestion.highlight;
			if (range) {
				textEl.appendText(suggestion.text.slice(0, range[0]));
				textEl.createSpan({ text: suggestion.text.slice(range[0], range[1]), cls: "task-time-tracker-search-suggest-match" });
				textEl.appendText(suggestion.text.slice(range[1]));
			} else {
				textEl.setText(suggestion.text);
			}
			// Same raw form as the Edit task modal's "tt-id" row, so an id
			// copied from there visibly matches here.
			rowEl.createSpan({ text: suggestion.taskId, cls: "task-time-tracker-search-suggest-id" });

			rowEl.addEventListener("mousedown", (evt) => evt.preventDefault());
			rowEl.addEventListener("click", () => this.onPick(suggestion));
		});

		const active = this.highlighted >= 0 ? `${this.listId}-${this.highlighted}` : null;
		if (active) {
			this.inputEl.setAttribute("aria-activedescendant", active);
			popoverEl.querySelector(`#${active}`)?.scrollIntoView({ block: "nearest" });
		} else {
			this.inputEl.removeAttribute("aria-activedescendant");
		}
	}
}
