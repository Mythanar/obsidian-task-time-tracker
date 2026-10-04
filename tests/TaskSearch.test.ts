// tests/TaskSearch.test.ts
// Task search matching (see src/core/TaskSearch.ts): case/accent
// insensitivity, tt-id matching, per-task (not per-session) matching, and
// suggestion highlighting in the original text's indices.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySearchFilter, findMatchRange, getSearchSuggestions } from "../src/core/TaskSearch";
import { TimeEntry } from "../src/types";

function entry(id: string, taskId: string, taskText: string, start: number): TimeEntry {
	return { id, taskId, taskText, filePath: "note.md", start, end: start + 1000 };
}

const entries: TimeEntry[] = [
	entry("e1", "aB3dE9xY", "Sync posthog events", 100),
	entry("e2", "Qw7rT2pZ", "Debug PostHog webhook", 200),
	entry("e3", "Mn4kL8vC", "Revisión del diseño", 300),
	// Same task, renamed after its first session.
	entry("e4", "Rn1mD5eX", "Old name", 400),
	entry("e5", "Rn1mD5eX", "New name", 500),
];

describe("applySearchFilter", () => {
	it("matches as a substring, ignoring case", () => {
		const result = applySearchFilter(entries, { query: "POSTHOG", taskId: null });
		assert.deepEqual(result.map((e) => e.id), ["e1", "e2"]);
	});

	it("ignores accents in both directions", () => {
		assert.deepEqual(applySearchFilter(entries, { query: "revision", taskId: null }).map((e) => e.id), ["e3"]);
		assert.deepEqual(applySearchFilter(entries, { query: "DISEÑO", taskId: null }).map((e) => e.id), ["e3"]);
	});

	it("finds a task by its tt-id even though the id isn't in its text", () => {
		assert.deepEqual(applySearchFilter(entries, { query: "qw7rt2pz", taskId: null }).map((e) => e.id), ["e2"]);
	});

	it("matches per task: an old name brings every session of the renamed task", () => {
		const result = applySearchFilter(entries, { query: "old name", taskId: null });
		assert.deepEqual(result.map((e) => e.id), ["e4", "e5"]);
	});

	it("a picked suggestion filters by task id, not by text", () => {
		const result = applySearchFilter(entries, { query: "New name", taskId: "Rn1mD5eX" });
		assert.deepEqual(result.map((e) => e.id), ["e4", "e5"]);
	});

	it("returns nothing for a text that matches nothing", () => {
		assert.equal(applySearchFilter(entries, { query: "zzz", taskId: null }).length, 0);
	});
});

describe("getSearchSuggestions", () => {
	it("returns one suggestion per task, most recent first, showing the latest name", () => {
		const result = getSearchSuggestions(entries, "name", 10);
		assert.deepEqual(result, [{ taskId: "Rn1mD5eX", text: "New name", highlight: [4, 8] }]);
	});

	it("has no highlight when only the tt-id matched", () => {
		const [suggestion] = getSearchSuggestions(entries, "aB3d", 10);
		assert.equal(suggestion?.taskId, "aB3dE9xY");
		assert.equal(suggestion?.highlight, null);
	});

	it("respects the limit and ignores an empty query", () => {
		assert.equal(getSearchSuggestions(entries, "e", 2).length, 2);
		assert.deepEqual(getSearchSuggestions(entries, "   ", 10), []);
	});
});

describe("findMatchRange", () => {
	it("maps the match back onto the original text, accents included", () => {
		assert.deepEqual(findMatchRange("Revisión del diseño", "revision"), [0, 8]);
		assert.deepEqual(findMatchRange("Revisión del diseño", "DISENO"), [13, 19]);
	});

	it("handles decomposed (NFD) input text", () => {
		const decomposed = "Revisión";
		assert.deepEqual(findMatchRange(decomposed, "revision"), [0, decomposed.length]);
	});
});
