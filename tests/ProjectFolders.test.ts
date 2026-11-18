// tests/ProjectFolders.test.ts
// "Project by folder" (see src/core/ProjectFolders.ts and
// src/core/TaskLocations.ts): effective project (folder wins, nested
// folders, segment matching, latent manual assignments), link impact for
// the D1/D2 dialog, note moves, folder renames, the task location index,
// and survival of the new field across loads.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	collapsePath,
	computeLinkImpact,
	computeMoveChanges,
	folderProjectForPath,
	normalizeFolderPath,
	projectFoldersOutsideTracking,
	renameProjectFolders,
	resolveTaskProject,
	splitPathAtFolder,
	TaskInfo,
} from "../src/core/ProjectFolders";
import { TaskLocations, taskIdsIn } from "../src/core/TaskLocations";
import { normalizeState } from "../src/core/StateStore";
import { Project } from "../src/types";

const p1: Project = { id: "p1", name: "Proyecto 1", folder: "Projects/A" };
const p2: Project = { id: "p2", name: "Proyecto 2", folder: "Projects/A/B" };
const manual: Project = { id: "m", name: "Manual" };
const projects = [p1, p2, manual];

describe("resolveTaskProject", () => {
	it("CA1: a task in a subfolder of a project folder gets that project", () => {
		const r = resolveTaskProject(projects, undefined, "Projects/A/sub/nota.md");
		assert.equal(r.project?.id, "p1");
		assert.equal(r.source, "folder");
	});

	it("CA2: with nested folders, the most specific one wins", () => {
		assert.equal(resolveTaskProject(projects, undefined, "Projects/A/B/x.md").project?.id, "p2");
	});

	it("CA3: matching is by segment", () => {
		assert.equal(folderProjectForPath("Projects/AB/x.md", projects), null);
	});

	it("CA4: the folder overrides a manual assignment, which comes back when unlinked", () => {
		assert.equal(resolveTaskProject(projects, "m", "Projects/A/x.md").project?.id, "p1");
		const unlinked = projects.map((p) => (p.id === "p1" ? { ...p, folder: undefined } : p));
		const r = resolveTaskProject(unlinked, "m", "Projects/A/x.md");
		assert.equal(r.project?.id, "m");
		assert.equal(r.source, "manual");
	});

	it("ignores a manual assignment to a folder project outside its folder", () => {
		const r = resolveTaskProject(projects, "p1", "Other/x.md");
		assert.equal(r.project, null);
		assert.equal(r.source, "none");
	});

	it("uses only the manual assignment when the note is unknown", () => {
		assert.equal(resolveTaskProject(projects, "m", null).project?.id, "m");
	});

	it("resolves an alias to its project, and ignores folders on aliases", () => {
		const list: Project[] = [manual, { id: "alias", name: "Manual", aliasOf: "m", folder: "X" }];
		assert.equal(resolveTaskProject(list, "alias", "X/y.md").project?.id, "m");
	});
});

describe("computeLinkImpact", () => {
	const task = (taskId: string, notePath: string | null, manualProjectId?: string, trackedMs = 0): TaskInfo => ({
		taskId,
		notePath,
		manualProjectId,
		trackedMs,
	});

	it("counts tasks that join, those set by hand, and those that lose the project", () => {
		const before: Project[] = [{ id: "a", name: "A" }, manual];
		const after: Project[] = [{ id: "a", name: "A", folder: "Work" }, manual];
		const impact = computeLinkImpact("a", before, after, [
			task("t1", "Work/x.md", undefined, 60_000),
			task("t2", "Work/y.md", "m", 120_000),
			task("t3", "Home/z.md", "a"),
			task("t4", "Home/w.md"),
		]);
		assert.deepEqual(impact, { gained: 2, gainedMs: 180_000, overriddenManual: 1, lostManual: 1, lostOther: 0 });
	});

	it("counts tasks left in the old folder when the folder changes", () => {
		const before: Project[] = [{ id: "a", name: "A", folder: "Old" }];
		const after: Project[] = [{ id: "a", name: "A", folder: "New" }];
		const impact = computeLinkImpact("a", before, after, [task("t1", "Old/x.md"), task("t2", "New/y.md")]);
		assert.equal(impact.gained, 1);
		assert.equal(impact.lostOther, 1);
	});
});

describe("computeMoveChanges", () => {
	it("reports tasks that changed project because their note moved", () => {
		const changes = computeMoveChanges(projects, projects, [
			{ oldPath: "Projects/A/x.md", newPath: "Projects/A/B/x.md", tasks: [{ taskId: "t1" }, { taskId: "t2" }] },
			{ oldPath: "Projects/A/y.md", newPath: "Inbox/y.md", tasks: [{ taskId: "t3" }] },
			{ oldPath: "Projects/A/z.md", newPath: "Projects/A/zz.md", tasks: [{ taskId: "t4" }] },
		]);
		assert.equal(changes.get(p2), 2);
		assert.equal(changes.get(null), 1);
		assert.equal(changes.size, 2);
	});

	it("reports nothing when a project folder moves with its notes", () => {
		const after = projects.map((p) => ({ ...p }));
		renameProjectFolders(after, "Projects", "Archive/Projects");
		const changes = computeMoveChanges(projects, after, [
			{ oldPath: "Projects/A/x.md", newPath: "Archive/Projects/A/x.md", tasks: [{ taskId: "t1" }] },
		]);
		assert.equal(changes.size, 0);
	});
});

describe("folder helpers", () => {
	it("renames project folders at or below the renamed folder, by segment", () => {
		const list: Project[] = [
			{ id: "1", name: "1", folder: "Projects/A" },
			{ id: "2", name: "2", folder: "Projects/AB" },
		];
		assert.equal(renameProjectFolders(list, "Projects/A", "Work/A"), true);
		assert.deepEqual(
			list.map((p) => p.folder),
			["Work/A", "Projects/AB"],
		);
		assert.equal(renameProjectFolders(list, "Projects/A", "Work/A"), false);
	});

	it("normalizes stored folder values", () => {
		assert.equal(normalizeFolderPath("/Projects/A/"), "Projects/A");
		assert.equal(normalizeFolderPath("  "), undefined);
		assert.equal(normalizeFolderPath("/"), undefined);
		assert.equal(normalizeFolderPath(42), undefined);
	});

	it("finds project folders outside Tracking folders (none when the list is empty)", () => {
		assert.deepEqual([...projectFoldersOutsideTracking(projects, ["Projects/A/B"])], ["p1"]);
		assert.equal(projectFoldersOutsideTracking(projects, []).size, 0);
	});

	it("splits the path at the project folder's last segment", () => {
		assert.deepEqual(splitPathAtFolder("Projects/Project A/Subfolder 1/meeting.md", "Projects/Project A"), [
			"Projects/",
			"Project A",
			"/Subfolder 1/meeting.md",
		]);
		assert.equal(splitPathAtFolder("Other/x.md", "Projects/A"), null);
	});

	it("collapses long paths, keeping the project folder", () => {
		assert.equal(
			collapsePath("Projects/Project A/2026/Q4/Retros/meeting.md", "Projects/Project A"),
			"Projects/Project A/…/Retros/meeting.md",
		);
		assert.equal(collapsePath("A/b.md"), "A/b.md");
	});
});

describe("TaskLocations", () => {
	it("finds every tt-id in a note", () => {
		assert.deepEqual([...taskIdsIn("- [ ] a [tt-id:: abc12345]\n- [x] b [tt-id:: XYZ98765] ✅ 2026-01-01")], [
			"abc12345",
			"XYZ98765",
		]);
		assert.equal(taskIdsIn("no tasks").size, 0);
	});

	it("locates a task, preferring the latest session's note among duplicates", () => {
		const index = new TaskLocations();
		index.setFile("B/x.md", new Set(["t1"]));
		index.setFile("A/y.md", new Set(["t1"]));
		assert.equal(index.locate("t1", "B/x.md"), "B/x.md");
		assert.equal(index.locate("t1", "Gone/z.md"), "A/y.md");
		assert.equal(index.locate("t2", "Gone/z.md"), "Gone/z.md");
	});

	it("follows renames of notes and folders, and deletions", () => {
		const index = new TaskLocations();
		index.setFile("Projects/A/x.md", new Set(["t1"]));
		index.setFile("Projects/AB/y.md", new Set(["t2"]));
		assert.deepEqual(index.rename("Projects/A", "Work/A"), [["Projects/A/x.md", "Work/A/x.md"]]);
		assert.equal(index.locate("t1", null), "Work/A/x.md");
		assert.equal(index.locate("t2", null), "Projects/AB/y.md");
		assert.deepEqual(index.rename("Projects/A", "Work/A"), []);
		assert.equal(index.removeUnder("Work"), true);
		assert.equal(index.locate("t1", "Projects/A/x.md"), "Projects/A/x.md");
	});

	it("reports whether a note's tasks changed", () => {
		const index = new TaskLocations();
		assert.equal(index.setFile("x.md", new Set(["t1"])), true);
		assert.equal(index.setFile("x.md", new Set(["t1"])), false);
		assert.equal(index.setFile("x.md", new Set()), true);
		assert.equal(index.setFile("y.md", new Set()), false);
	});
});

describe("stored project folder", () => {
	it("is read and kept when loading", () => {
		const state = normalizeState({ projects: [{ id: "p", name: "P", folder: "Projects/P/" }, { id: "q", name: "Q" }] });
		assert.equal(state.projects[0]?.folder, "Projects/P");
		assert.equal(state.projects[1]?.folder, undefined);
	});
});
