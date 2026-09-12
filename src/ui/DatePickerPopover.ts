// ui/DatePickerPopover.ts
// Date picker (see the "Selector de fecha en el panel Time Tracker"
// note): calendar icon next to the Historial's date navigator, opens
// this popover to jump straight to a specific day or week, without
// stepping through the arrows day by day / week by week. Same anchoring
// mechanism as ProjectPickerList.ts (see positionPopover.ts).
//
// Every click (day, week, or the footer's "Today") applies immediately
// by calling onChange, without waiting for confirmation. The picker does
// NOT close on apply, only on an outside click (or Escape). A second
// click on ANOTHER day while a day is pending completes a range between
// both points (with its own hint in the footer while that second click
// is awaited); a click on a week number always replaces the selection
// with that full week, it never joins a previous day to form a range.
//
// onChange(start, end) is always a pair: a lone day is emitted as (day,
// day). The caller (TimeLogView) decides what to do with the range:
// start === end -> Day view; a range that matches a Monday-Sunday week
// exactly -> Week view (the picker doesn't distinguish this from a
// direct click on the week number, nor does it need to); any other
// arbitrary range doesn't navigate yet — pending "Vista de resultados
// por rango". The footer's removed "Limpiar" button is documented in
// docs/DECISIONS.md.

import { setIcon } from "obsidian";
import { t } from "../i18n";
import { positionPopover } from "./positionPopover";

export interface DatePickerPopoverOptions {
	anchorEl: HTMLElement;
	// Day shown as the initial selection (normally the panel's
	// anchorDate) and month shown on open.
	selectedDate: number;
	// End of the range already active in the panel (see
	// docs/DECISIONS.md). Optional: if omitted, selectedDate === end is
	// assumed (a lone day), which is the usual behavior for Day/Week
	// when the caller has no range to preserve.
	selectedRangeEnd?: number;
	// Called on every click that resolves something (day, week, or
	// "Today"), never on the click that only starts a half-finished
	// range — see the header comment. start/end in ms (startOfDay);
	// start <= end always.
	onChange: (start: number, end: number) => void;
	onClose?: () => void;
}

function addDays(dateAtMidnightMs: number, days: number): number {
	const d = new Date(dateAtMidnightMs);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0).getTime();
}

function startOfDay(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

// Monday-to-Sunday week — same criterion as
// TimeLogView.ts#startOfWeek (duplicated locally: it's four lines, not
// enough to justify a shared module just for this).
function startOfWeek(ms: number): number {
	const dayStart = startOfDay(ms);
	const weekday = new Date(dayStart).getDay(); // 0 = Sunday ... 6 = Saturday
	const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
	return addDays(dayStart, diffToMonday);
}

function startOfMonth(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
}

function addMonths(ms: number, months: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth() + months, 1, 0, 0, 0, 0).getTime();
}

// ISO 8601 week number: defined by that week's (Monday-Sunday) Thursday
// — the year containing that Thursday is the "ISO year", and the week
// number is the Thursday's day-of-year divided by 7, rounded up.
function isoWeekNumber(weekStartMonday: number): number {
	const thursday = new Date(addDays(weekStartMonday, 3));
	const firstJan = new Date(thursday.getFullYear(), 0, 1);
	const dayOfYear = Math.round((thursday.getTime() - firstJan.getTime()) / 86400000) + 1;
	return Math.ceil(dayOfYear / 7);
}

function formatShortDate(ms: number): string {
	return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// Footer label: same criterion as the reference design's label() (Date
// Filter.dc.html) — a lone day ("12 ago"), a full week ("Semana 34 · 12
// ago – 18 ago"), a range within the same month ("12 – 18 ago"), or one
// crossing months ("12 ago – 18 sep").
function formatSelectionLabel(start: number, end: number): string {
	if (start === end) return formatShortDate(start);

	if (start === startOfWeek(start) && end === addDays(start, 6)) {
		return t("log.datePickerWeekLabel", {
			week: String(isoWeekNumber(start)),
			start: formatShortDate(start),
			end: formatShortDate(end),
		});
	}

	const a = new Date(start);
	const b = new Date(end);
	if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
		return `${a.getDate()} – ${formatShortDate(end)}`;
	}
	return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

// At most one popover of this component open at a time (same criterion
// as ProjectPickerList.ts) — opening a new one closes the previous one.
// Independent of ProjectPickerList's singleton: they're two different
// popover types, but each closes as soon as a click falls outside
// itself, so opening one while the other is open already closes it via
// the other's "outside click" listener.
let activePopover: {
	anchorEl: HTMLElement;
	popoverEl: HTMLElement;
	options: DatePickerPopoverOptions;
	close: () => void;
} | null = null;

// Reanchors the active popover to a new button element, without closing
// it or losing its internal state (month shown, pending range
// selection). Needed because TimeLogView rebuilds its whole navigation
// bar from scratch on every render (container.empty()) — including the
// calendar button, and that render is also triggered by this picker's
// own onChange when a selection (day/week/range) is applied. Without
// reanchoring, both the "outside click" listener and the open/close
// singleton kept comparing against the old button, already unmounted
// from the DOM (see docs/DECISIONS.md). The caller must call this after
// every render with the fresh button reference — a no-op if no popover
// is open.
export function reanchorDatePickerPopover(newAnchorEl: HTMLElement): void {
	if (!activePopover) return;
	activePopover.anchorEl = newAnchorEl;
	activePopover.options.anchorEl = newAnchorEl;
	positionPopover(activePopover.popoverEl, newAnchorEl);
}

export function openDatePickerPopover(options: DatePickerPopoverOptions): void {
	if (activePopover && activePopover.anchorEl === options.anchorEl) {
		activePopover.close();
		return;
	}
	activePopover?.close();

	const popoverEl = document.body.createDiv({ cls: "task-time-tracker-datepicker-popover" });
	let displayMonth = startOfMonth(options.selectedDate);
	let start = startOfDay(options.selectedDate);
	let end = startOfDay(options.selectedRangeEnd ?? options.selectedDate);
	// true between the first and second click of a day range — the
	// footer shows a hint meanwhile (see formatFooterLabel). A click on
	// a week or on "Today" always leaves it false: they resolve
	// immediately, they're never the first step of a range.
	let pending = false;

	const headerEl = popoverEl.createDiv({ cls: "task-time-tracker-datepicker-header" });
	const prevBtn = headerEl.createEl("button", { cls: "clickable-icon" });
	setIcon(prevBtn, "chevron-left");
	prevBtn.setAttribute("aria-label", t("log.datePickerPrevMonth"));
	prevBtn.addEventListener("click", () => {
		displayMonth = addMonths(displayMonth, -1);
		renderGrid();
	});

	const monthLabelEl = headerEl.createSpan({ cls: "task-time-tracker-datepicker-month-label" });

	const nextBtn = headerEl.createEl("button", { cls: "clickable-icon" });
	setIcon(nextBtn, "chevron-right");
	nextBtn.setAttribute("aria-label", t("log.datePickerNextMonth"));
	nextBtn.addEventListener("click", () => {
		displayMonth = addMonths(displayMonth, 1);
		renderGrid();
	});

	// Weekday name row: its own grid with the same column template as
	// each week row (see renderGrid) — they align by matching widths, not
	// by sharing a single container.
	const weekdayHeaderEl = popoverEl.createDiv({ cls: "task-time-tracker-datepicker-weekday-header" });
	weekdayHeaderEl.createDiv({ cls: "task-time-tracker-datepicker-cell task-time-tracker-datepicker-weekcol-header" });
	const firstMondayOfWeekRow = startOfWeek(displayMonth);
	for (let i = 0; i < 7; i++) {
		const label = new Date(addDays(firstMondayOfWeekRow, i)).toLocaleDateString(undefined, { weekday: "short" });
		weekdayHeaderEl.createDiv({ text: label, cls: "task-time-tracker-datepicker-cell task-time-tracker-datepicker-weekday" });
	}

	const gridEl = popoverEl.createDiv({ cls: "task-time-tracker-datepicker-grid" });

	const footerEl = popoverEl.createDiv({ cls: "task-time-tracker-datepicker-footer" });
	const footerLabelEl = footerEl.createSpan({ cls: "task-time-tracker-datepicker-footer-label" });
	const footerActionsEl = footerEl.createDiv({ cls: "task-time-tracker-datepicker-footer-actions" });
	const todayBtn = footerActionsEl.createEl("button", { text: t("log.today") });
	todayBtn.addEventListener("click", () => goToToday());

	function onDayClick(dayStart: number): void {
		// Second click on ANOTHER day while a day is pending: completes
		// the range. Any other case (no pending, re-click on the same
		// day, or a range was already resolved) starts a new pending day
		// — only chained day+day clicks form a range.
		if (pending && dayStart !== start) {
			const a = Math.min(start, dayStart);
			const b = Math.max(start, dayStart);
			start = a;
			end = b;
			pending = false;
		} else {
			start = dayStart;
			end = dayStart;
			pending = true;
		}
		options.onChange(start, end);
		renderGrid();
	}

	function onWeekClick(weekStart: number): void {
		start = weekStart;
		end = addDays(weekStart, 6);
		pending = false;
		options.onChange(start, end);
		renderGrid();
	}

	function goToToday(): void {
		const today = startOfDay(Date.now());
		start = today;
		end = today;
		pending = false;
		displayMonth = startOfMonth(today);
		options.onChange(start, end);
		renderGrid();
	}

	function renderGrid(): void {
		const label = new Date(displayMonth).toLocaleDateString(undefined, { month: "long", year: "numeric" });
		monthLabelEl.setText(label.charAt(0).toUpperCase() + label.slice(1));

		gridEl.empty();

		const today = startOfDay(Date.now());
		const firstMonday = startOfWeek(displayMonth);
		const lastOfMonth = addDays(addMonths(displayMonth, 1), -1);

		// Variable number of weeks depending on the real month (4 to 6),
		// not a fixed number — each row is its own grid with the same
		// column template as the weekday header, separated by a top
		// border.
		let weekStart = firstMonday;
		while (weekStart <= lastOfMonth) {
			const thisWeekStart = weekStart;
			const weekEnd = addDays(thisWeekStart, 6);
			const weekNumber = isoWeekNumber(thisWeekStart);
			const weekSelected = thisWeekStart === start && weekEnd === end;

			const rowEl = gridEl.createDiv({ cls: "task-time-tracker-datepicker-week-row" });

			const weekBtn = rowEl.createEl("button", {
				// "W" prefix (see the reference design, Date Filter.dc.html):
				// tells it apart from a day number at a glance, not just by
				// style.
				text: `W${weekNumber}`,
				cls: "task-time-tracker-datepicker-cell task-time-tracker-datepicker-weeknum",
			});
			weekBtn.toggleClass("is-selected", weekSelected);
			weekBtn.setAttribute("aria-label", t("log.datePickerSelectWeekAriaLabel", { week: String(weekNumber) }));
			weekBtn.addEventListener("click", () => onWeekClick(thisWeekStart));

			for (let day = 0; day < 7; day++) {
				const dayStart = addDays(thisWeekStart, day);
				const isEdge = dayStart === start || dayStart === end;
				const isInside = !isEdge && dayStart > start && dayStart < end;

				const dayBtn = rowEl.createEl("button", {
					text: String(new Date(dayStart).getDate()),
					cls: "task-time-tracker-datepicker-cell task-time-tracker-datepicker-day",
				});
				dayBtn.toggleClass("is-outside-month", new Date(dayStart).getMonth() !== new Date(displayMonth).getMonth());
				dayBtn.toggleClass("is-today", dayStart === today);
				dayBtn.toggleClass("is-selected", isEdge);
				dayBtn.toggleClass("is-in-range", isInside);
				dayBtn.addEventListener("click", () => onDayClick(dayStart));
			}

			weekStart = addDays(weekStart, 7);
		}

		const label_ = pending
			? t("log.datePickerPendingHint", { label: formatSelectionLabel(start, end) })
			: formatSelectionLabel(start, end);
		footerLabelEl.setText(label_);
	}

	renderGrid();
	positionPopover(popoverEl, options.anchorEl);

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

	// Same as in ProjectPickerList.ts: the mousedown that opened this
	// popover already happened before this code runs, so registering the
	// listener now doesn't immediately close it on itself.
	document.addEventListener("mousedown", onOutsideMousedown, true);
	document.addEventListener("keydown", onKeydown, true);

	activePopover = { anchorEl: options.anchorEl, popoverEl, options, close };
}
