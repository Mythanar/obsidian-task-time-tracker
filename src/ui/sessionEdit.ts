// ui/sessionEdit.ts
// Pure date/time functions and the read-only session renderer, shared
// between TimeLogView.ts (card, expanded read-only detail) and
// EditTaskModal.ts (the only way to edit sessions).

import { Platform } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { t } from "../i18n";
import { TimeEntry } from "../types";

// Transient editing state for a session inside the modal: only one at a
// time, never persisted. A click outside the row doesn't discard it
// (only Save/Cancel/Delete do). The four fields (start date, start time,
// end date, end time) are plain text fields ("YYYY-MM-DD"/"HH:MM:SS"),
// including the end date: it's no longer inferred by comparing times,
// it's just another value the user controls directly. If cancelled, the
// original session stays intact.
// {field}Evaluated: whether that field has gone through blur or reached
// full length at least once since the last change (see bindDraftField in
// EditTaskModal.ts) — until then, an invalid format isn't shown yet (the
// user is still typing).
export interface EditDraft {
	entryId: string;
	startDate: string;
	startDateEvaluated: boolean;
	startTime: string;
	startTimeEvaluated: boolean;
	endDate: string;
	endDateEvaluated: boolean;
	endTime: string;
	endTimeEvaluated: boolean;
	error: string | null;
	confirmingDelete: boolean;
}

export interface ParsedTime {
	hours: number;
	minutes: number;
	seconds: number;
}

const TIME_INPUT_REGEX = /^([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
const DATE_INPUT_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

export function formatDateInput(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "HH:MM:SS" in local time (see EditDraft).
export function formatHMS(ms: number): string {
	const d = new Date(ms);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function parseTimeInput(value: string): ParsedTime | null {
	const match = value.trim().match(TIME_INPUT_REGEX);
	if (!match) return null;
	return { hours: Number(match[1]), minutes: Number(match[2]), seconds: Number(match[3]) };
}

// Returns that date's local midnight, or null if the field doesn't have
// the "YYYY-MM-DD" format <input type="date"> produces, or if the day
// doesn't exist in that month/year (e.g. "2026-08-88", or "2026-02-29"
// in a non-leap year). The Date constructor alone does NOT reject this:
// it silently overflows into following months/years (new Date(2026, 7,
// 88) gives October), so the date is rebuilt and compared
// component-by-component against what was typed — if Date reinterpreted
// it, something won't match and it's rejected (see docs/DECISIONS.md).
export function parseDateInput(value: string): number | null {
	const match = value.match(DATE_INPUT_REGEX);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = new Date(year, month, day);
	if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
	return date.getTime();
}

function combineDateAndTime(dateAtMidnightMs: number, time: ParsedTime): number {
	const d = new Date(dateAtMidnightMs);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), time.hours, time.minutes, time.seconds, 0).getTime();
}

// Number of calendar days difference between startMs's date (date part,
// no time) and endMs's — for the static session row's "+N" badge. Both
// dates are normalized with Date.UTC(y, m, d) — not a direct timestamp
// subtraction or days * 86400000 in local time — so the result is
// always an exact integer even if the range crosses a daylight saving
// change between those two dates.
function getDaySpan(startMs: number, endMs: number): number {
	const s = new Date(startMs);
	const e = new Date(endMs);
	const startUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
	const endUtc = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
	return Math.round((endUtc - startUtc) / 86400000);
}

// Two [start, end) ranges overlap if each starts before the other ends.
// An active session (no end) is treated as if it ended "now" for this
// purpose.
export function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
	return startA < endB && startB < endA;
}

export type DraftResolution = { ok: true; start: number; end: number } | { ok: false; error: string };

// Resolves the final range from the draft's four fields, exactly as the
// user left them (seconds included, nothing forced). End date and start
// date are independent: what decides whether the session crosses
// midnight (or several days) is the typed end date itself, not an
// inference by comparing times.
export function resolveDraftTimestamps(draft: EditDraft): DraftResolution {
	const startDateMs = parseDateInput(draft.startDate);
	const endDateMs = parseDateInput(draft.endDate);
	const start = parseTimeInput(draft.startTime);
	const end = parseTimeInput(draft.endTime);
	if (startDateMs === null || endDateMs === null || !start || !end) {
		return { ok: false, error: t("log.errorFormat") };
	}

	return {
		ok: true,
		start: combineDateAndTime(startDateMs, start),
		end: combineDateAndTime(endDateMs, end),
	};
}

// For the end that hasn't been touched (its text is still the same it
// had when editing opened, both date and time), the session's real
// timestamp is used instead of the one resolveDraftTimestamps()
// rebuilt — avoids any precision difference between the two calculations.
export function effectiveRange(draft: EditDraft, entry: TimeEntry, resolved: { start: number; end: number }) {
	const startUnchanged = draft.startDate === formatDateInput(entry.start) && draft.startTime === formatHMS(entry.start);
	const endUnchanged =
		draft.endDate === formatDateInput(entry.end as number) && draft.endTime === formatHMS(entry.end as number);
	return {
		start: startUnchanged ? entry.start : resolved.start,
		end: endUnchanged ? (entry.end as number) : resolved.end,
	};
}

// Date + start time + end time (with a "+N" indicator if it spans more
// than one calendar day) + duration. Read-only: the single renderer for
// a session row, used both by the card (expanded detail) and by the Edit
// modal (rows not selected for editing). onLiveTick, if passed, is
// invoked with an ongoing session's counter element so the caller can
// register it in its own per-second tick mechanism (the card already has
// one via the tracking bus; the modal, being a transient surface,
// doesn't need its own and leaves the value static as it was when it
// opened).
export function renderSessionInfo(
	container: Element,
	entry: TimeEntry,
	onLiveTick?: (counterEl: HTMLElement, completedMs: number, start: number) => void,
): void {
	const info = container.createDiv({ cls: "task-time-tracker-log-session-info" });

	// Left column (date + time range): grouped apart from the duration
	// so the latter always stays aligned right, with a fixed min-width
	// on the date so it acts as a consistent column across rows.
	const left = info.createDiv({ cls: "task-time-tracker-log-session-left" });
	const startDate = new Date(entry.start);
	left.createSpan({ text: startDate.toLocaleDateString(), cls: "task-time-tracker-log-session-date" });

	const rangeSpan = left.createSpan({ cls: "task-time-tracker-log-session-range" });
	rangeSpan.createSpan({ text: startDate.toLocaleTimeString() });
	rangeSpan.createSpan({ text: " → ", cls: "task-time-tracker-log-session-arrow" });
	if (entry.end !== null) {
		rangeSpan.createSpan({ text: new Date(entry.end).toLocaleTimeString() });
		const daySpan = getDaySpan(entry.start, entry.end);
		if (daySpan > 0) {
			rangeSpan.createSpan({ text: ` +${daySpan}`, cls: "task-time-tracker-log-nextday-badge" });
			// Supporting end date, only next to the badge: on long
			// sessions (large +N) it saves the user from manually
			// calculating the end date from the start date. Not rendered
			// on mobile: screen width is more critical there.
			if (!Platform.isMobile) {
				rangeSpan.createSpan({
					text: ` (${new Date(entry.end).toLocaleDateString()})`,
					cls: "task-time-tracker-log-nextday-date",
				});
			}
		}
	} else {
		rangeSpan.createSpan({ text: t("log.ongoing"), cls: "task-time-tracker-log-ongoing" });
	}

	if (entry.end !== null) {
		info.createSpan({
			text: formatDuration(entry.end - entry.start),
			cls: "task-time-tracker-log-session-duration",
		});
		return;
	}

	// Ongoing session: same pulsing dot + counter already used by the
	// badge next to the checkbox and the active card's stop button,
	// instead of a lone dash.
	const live = info.createDiv({
		cls: "task-time-tracker-log-session-duration task-time-tracker-log-session-live",
	});
	live.createSpan({ cls: "task-time-tracker-inline-dot" });
	const counter = live.createSpan({ cls: "task-time-tracker-log-session-live-value" });
	counter.setText(formatDuration(Date.now() - entry.start));
	if (onLiveTick) onLiveTick(counter, 0, entry.start);
}
