// core/TaskSearch.ts
// Task search over the Historial (see TimeLogView.ts): pure, in-memory,
// no vault reads. Compares against each session's immutable taskText
// snapshot (the line without its checkbox or tt-id, see types.ts) and
// against the tt-id itself — so a task whose note was deleted is still
// found, and a renamed task is still found by its old name.
//
// Matching is per TASK, not per session: if any session of a task
// matches, all of that task's sessions are in the result.

import { TimeEntry } from "../types";

// A confirmed search. taskId set: picked from the suggestions, filters to
// exactly that task. taskId null: Enter on free text, substring match.
export interface SearchFilter {
	query: string;
	taskId: string | null;
}

export interface SearchSuggestion {
	taskId: string;
	// The task's most recent snapshot, which is what the suggestion shows
	// and what the chip shows if it's picked.
	text: string;
	// [start, end) of the matched part of `text`, in `text`'s own indices;
	// null when only the tt-id matched.
	highlight: [number, number] | null;
}

// Case- and accent-insensitive comparison form.
function normalizeChar(ch: string): string {
	return ch.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function normalizeForSearch(text: string): string {
	return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Position of `query` inside `text`, insensitive to case and accents, in
// the ORIGINAL text's indices. Built char by char because normalizing can
// change the length (decomposed characters), so normalized indices can't
// be reused on the original string directly.
export function findMatchRange(text: string, query: string): [number, number] | null {
	const normalizedQuery = normalizeForSearch(query.trim());
	if (!normalizedQuery) return null;

	let normalized = "";
	const origIndexAt: number[] = [];
	let origIndex = 0;
	for (const ch of text) {
		const part = normalizeChar(ch);
		for (let i = 0; i < part.length; i++) origIndexAt.push(origIndex);
		normalized += part;
		origIndex += ch.length;
	}
	origIndexAt.push(origIndex);

	const at = normalized.indexOf(normalizedQuery);
	if (at === -1) return null;
	const start = origIndexAt[at] ?? 0;
	const lastCharStart = origIndexAt[at + normalizedQuery.length - 1] ?? start;
	const lastChar = text.slice(lastCharStart).codePointAt(0);
	const end = lastCharStart + (lastChar !== undefined && lastChar > 0xffff ? 2 : 1);
	return [start, end];
}

function entryMatches(entry: TimeEntry, normalizedQuery: string): boolean {
	return (
		normalizeForSearch(entry.taskText).includes(normalizedQuery) ||
		normalizeForSearch(entry.taskId).includes(normalizedQuery)
	);
}

export function applySearchFilter(entries: TimeEntry[], filter: SearchFilter): TimeEntry[] {
	if (filter.taskId !== null) {
		return entries.filter((entry) => entry.taskId === filter.taskId);
	}
	const normalizedQuery = normalizeForSearch(filter.query.trim());
	if (!normalizedQuery) return entries;
	const matchedTaskIds = new Set<string>();
	for (const entry of entries) {
		if (entryMatches(entry, normalizedQuery)) matchedTaskIds.add(entry.taskId);
	}
	return entries.filter((entry) => matchedTaskIds.has(entry.taskId));
}

// One suggestion per matching task, most recently tracked first.
export function getSearchSuggestions(entries: TimeEntry[], query: string, limit: number): SearchSuggestion[] {
	const normalizedQuery = normalizeForSearch(query.trim());
	if (!normalizedQuery) return [];

	const latestByTask = new Map<string, TimeEntry>();
	const matchedTaskIds = new Set<string>();
	for (const entry of entries) {
		const latest = latestByTask.get(entry.taskId);
		if (!latest || entry.start > latest.start) latestByTask.set(entry.taskId, entry);
		if (entryMatches(entry, normalizedQuery)) matchedTaskIds.add(entry.taskId);
	}

	return [...matchedTaskIds]
		.map((taskId) => latestByTask.get(taskId) as TimeEntry)
		.sort((a, b) => b.start - a.start)
		.slice(0, limit)
		.map((entry) => ({
			taskId: entry.taskId,
			text: entry.taskText,
			highlight: findMatchRange(entry.taskText, query),
		}));
}
