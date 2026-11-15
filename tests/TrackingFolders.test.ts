// tests/TrackingFolders.test.ts
// "Tracking folders" setting (see src/core/TrackingFolders.ts): segment
// matching, empty list = whole vault, rename of a listed folder or of a
// folder containing it, and survival of the list across saves from a
// version that doesn't know it.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeState } from "../src/core/StateStore";
import {
	isInTrackingFolders,
	isPathInFolder,
	normalizeTrackingFolders,
	renameInFolderList,
} from "../src/core/TrackingFolders";

describe("isPathInFolder", () => {
	it("matches files directly inside and in subfolders at any depth", () => {
		assert.equal(isPathInFolder("Projects/A/x.md", "Projects/A"), true);
		assert.equal(isPathInFolder("Projects/A/Sub/Deep/y.md", "Projects/A"), true);
	});

	it("compares by path segment", () => {
		assert.equal(isPathInFolder("Projects/AB/z.md", "Projects/A"), false);
		assert.equal(isPathInFolder("Projects/A.md", "Projects/A"), false);
	});
});

describe("isInTrackingFolders", () => {
	it("an empty list means the whole vault", () => {
		assert.equal(isInTrackingFolders("anything/note.md", []), true);
		assert.equal(isInTrackingFolders("root.md", []), true);
	});

	it("with folders, only notes inside any of them", () => {
		const folders = ["Work", "Projects/A"];
		assert.equal(isInTrackingFolders("Work/note.md", folders), true);
		assert.equal(isInTrackingFolders("Projects/A/Sub/note.md", folders), true);
		assert.equal(isInTrackingFolders("Projects/AB/note.md", folders), false);
		assert.equal(isInTrackingFolders("root.md", folders), false);
	});
});

describe("renameInFolderList", () => {
	it("renames the listed folder itself", () => {
		assert.deepEqual(renameInFolderList(["A", "B"], "A", "Z"), ["Z", "B"]);
	});

	it("renames or moves a folder that contains a listed one", () => {
		assert.deepEqual(renameInFolderList(["Projects/A/Sub", "B"], "Projects", "Archive/Projects"), [
			"Archive/Projects/A/Sub",
			"B",
		]);
	});

	it("leaves sibling folders with a common prefix alone", () => {
		assert.equal(renameInFolderList(["Projects/AB"], "Projects/A", "Projects/X"), null);
	});

	it("returns null when nothing changes, so a repeated event is a no-op", () => {
		const once = renameInFolderList(["A/B"], "A", "Z");
		assert.deepEqual(once, ["Z/B"]);
		assert.equal(renameInFolderList(once ?? [], "A", "Z"), null);
	});

	it("drops a duplicate created by the rename", () => {
		assert.deepEqual(renameInFolderList(["Z", "A"], "A", "Z"), ["Z"]);
	});
});

describe("normalizeTrackingFolders", () => {
	it("keeps only non-empty unique strings", () => {
		assert.deepEqual(normalizeTrackingFolders(["A", "", 3, "A", "/", "B"]), ["A", "B"]);
		assert.deepEqual(normalizeTrackingFolders(undefined), []);
		assert.deepEqual(normalizeTrackingFolders("A"), []);
	});
});

describe("stored setting", () => {
	it("defaults to an empty list (whole vault)", () => {
		assert.deepEqual(normalizeState(null).settings.trackingFolders, []);
		assert.deepEqual(normalizeState({ settings: {} }).settings.trackingFolders, []);
	});

	it("is read back from data.json", () => {
		const state = normalizeState({ settings: { trackingFolders: ["Work"] } });
		assert.deepEqual(state.settings.trackingFolders, ["Work"]);
	});
});
