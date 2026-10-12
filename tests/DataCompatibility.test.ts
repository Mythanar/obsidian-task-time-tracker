// tests/DataCompatibility.test.ts
// Data compatibility between plugin versions (see src/core/StateStore.ts):
// unknown data written by a newer version survives every save from this
// one, the data format mark is written and never lowered, opening the
// plugin never saves, and data from a newer format locks project edits.
//
// Unlike tests/StateStore.test.ts, this fake disk stores whatever it is
// given as is (no normalization on write): it plays the role of a
// data.json written by a newer plugin version.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectManager } from "../src/core/ProjectManager";
import { DATA_FORMAT_VERSION, normalizeState, StateStore } from "../src/core/StateStore";
import { TrackingEngine } from "../src/core/TrackingEngine";
import { PluginState } from "../src/types";

type Json = Record<string, unknown>;

function makeRawDisk(initial: unknown) {
	let raw = initial === null ? "null" : JSON.stringify(initial);
	let saves = 0;
	return {
		io: {
			load: async () => JSON.parse(raw) as unknown,
			save: async (state: PluginState) => {
				saves++;
				raw = JSON.stringify(state);
			},
		},
		read: () => JSON.parse(raw) as Json,
		// What Obsidian Sync leaves on disk behind the plugin's back.
		replace: (next: unknown) => {
			raw = JSON.stringify(next);
		},
		saves: () => saves,
	};
}

// A data.json as a newer plugin version might write it: unknown fields at
// every level the plugin stores (top level, settings, projects, entries).
function newerData(over: Json = {}): Json {
	return {
		entries: [
			{ id: "e1", taskId: "t1", taskText: "Task 1", filePath: "a.md", start: 1000, end: 2000, billable: true },
		],
		settings: {
			toggl: { email: "", includeProjectClient: false, workspace: "W" },
			clockify: { email: "", includeProject: false, includeClient: false },
			logViewLocation: "sidebar",
			exportsFolder: "exports",
			taskIdFormat: "reduced",
			trackingFolders: ["Work"],
		},
		projects: [{ id: "p1", name: "Web", client: "Acme", clientId: "c1", color: "red" }],
		taskProjects: { t1: "p1" },
		clients: [{ id: "c1", name: "Acme" }],
		...over,
	};
}

function assertUnknownDataKept(disk: Json): void {
	assert.deepEqual(disk.clients, [{ id: "c1", name: "Acme" }]);
	const settings = disk.settings as Json;
	assert.deepEqual(settings.trackingFolders, ["Work"]);
	assert.equal((settings.toggl as Json).workspace, "W");
	const project = (disk.projects as Json[]).find((p) => p.id === "p1");
	assert.equal(project?.clientId, "c1");
	assert.equal(project?.color, "red");
	const entry = (disk.entries as Json[]).find((e) => e.id === "e1");
	assert.equal(entry?.billable, true);
}

describe("normalizeState keeps unknown data", () => {
	it("keeps unknown fields at the top level, in settings, projects and entries", () => {
		const state = normalizeState(newerData()) as unknown as Json;
		assertUnknownDataKept(state);
	});

	it("still falls back to the default for a known field with an unknown value", () => {
		const state = normalizeState(newerData({ settings: { logViewLocation: "floating" } }));
		assert.equal(state.settings.logViewLocation, "sidebar");
	});
});

describe("unknown data survives every save", () => {
	it("survives entry, settings and project operations", async () => {
		const disk = makeRawDisk(newerData());
		const store = new StateStore(disk.io);
		await store.init();
		const engine = new TrackingEngine(store);
		const projects = new ProjectManager(store);

		await engine.start("t2", "Task 2", "b.md");
		assertUnknownDataKept(disk.read());
		await engine.stop();
		assertUnknownDataKept(disk.read());
		await store.updateEntry("e1", { end: 3000 });
		assertUnknownDataKept(disk.read());
		await store.updateSettings((settings) => {
			settings.exportsFolder = "other";
		});
		assertUnknownDataKept(disk.read());
		assert.deepEqual(await projects.addProject("App", ""), { ok: true });
		assert.deepEqual(await projects.updateProject("p1", "Web 2", "Acme"), { ok: true });
		await projects.assignProject("t2", "p1");
		assertUnknownDataKept(disk.read());

		const project = (disk.read().projects as Json[]).find((p) => p.id === "p1");
		assert.equal(project?.name, "Web 2");
		assert.equal((disk.read().entries as Json[]).find((e) => e.id === "e1")?.end, 3000);
	});

	it("keeps unknown data that arrives through Sync after startup (re-read before each change)", async () => {
		const disk = makeRawDisk({ entries: [], projects: [] });
		const store = new StateStore(disk.io);
		await store.init();
		// Another device, on a newer version, saves after this one started.
		disk.replace(newerData());

		await store.updateSettings((settings) => {
			settings.taskIdFormat = "hidden";
		});
		assertUnknownDataKept(disk.read());
		await new TrackingEngine(store).start("t2", "Task 2", "b.md");
		assertUnknownDataKept(disk.read());
	});

	it("does not bring back unknown data from memory once it is gone from disk", async () => {
		const disk = makeRawDisk(newerData());
		const store = new StateStore(disk.io);
		await store.init();
		// The newer device removed its clients list; this stale memory still has it.
		const { clients: _removed, ...withoutClients } = newerData();
		disk.replace(withoutClients);

		await store.updateSettings((settings) => {
			settings.exportsFolder = "other";
		});
		assert.equal("clients" in disk.read(), false);
	});
});

describe("data format mark", () => {
	it("writes the current format on the next real save, not on load", async () => {
		const disk = makeRawDisk({ entries: [] });
		const store = new StateStore(disk.io);
		await store.init();
		assert.equal("formatVersion" in disk.read(), false);
		await store.updateSettings((settings) => {
			settings.exportsFolder = "other";
		});
		assert.equal(disk.read().formatVersion, DATA_FORMAT_VERSION);
	});

	it("never lowers a newer format mark", async () => {
		const disk = makeRawDisk(newerData({ formatVersion: DATA_FORMAT_VERSION + 1 }));
		const store = new StateStore(disk.io);
		await store.init();
		assert.equal(store.isNewerFormat(), true);
		await new TrackingEngine(store).start("t2", "Task 2", "b.md");
		assert.equal(disk.read().formatVersion, DATA_FORMAT_VERSION + 1);
		assertUnknownDataKept(disk.read());
	});

	it("treats a missing or invalid mark as format 1", () => {
		for (const formatVersion of [undefined, "2", 0, -3, 1.5]) {
			assert.equal(normalizeState({ formatVersion }).formatVersion, 1);
		}
	});
});

describe("opening the plugin never saves", () => {
	for (const [label, initial] of [
		["fresh install", null],
		["data from 0.0.33 (no format mark)", { entries: [], settings: { exportsFolder: "x" } }],
		["data from a newer version", newerData({ formatVersion: DATA_FORMAT_VERSION + 1 })],
		["data with an open session", newerData({ entries: [{ id: "e9", taskId: "t9", taskText: "", filePath: "", start: 1, end: null }] })],
	] as const) {
		it(`no save on load or on external change: ${label}`, async () => {
			const disk = makeRawDisk(initial);
			const before = JSON.stringify(disk.read());
			const store = new StateStore(disk.io);
			await store.init();
			const engine = new TrackingEngine(store);
			const projects = new ProjectManager(store);
			engine.getActiveEntry();
			engine.getEntries();
			projects.getProjects();
			await store.reload();
			assert.equal(disk.saves(), 0);
			assert.equal(JSON.stringify(disk.read()), before);
		});
	}

	it("tells a fresh install apart from existing data", async () => {
		const fresh = new StateStore(makeRawDisk(null).io);
		await fresh.init();
		assert.equal(fresh.isFreshInstall(), true);
		const existing = new StateStore(makeRawDisk({ entries: [] }).io);
		await existing.init();
		assert.equal(existing.isFreshInstall(), false);
	});
});

describe("data from a newer format locks project edits", () => {
	it("refuses to add, edit, delete or import projects, without saving", async () => {
		const disk = makeRawDisk(newerData({ formatVersion: DATA_FORMAT_VERSION + 1 }));
		const store = new StateStore(disk.io);
		await store.init();
		const projects = new ProjectManager(store);
		assert.equal(projects.isLocked(), true);

		assert.deepEqual(await projects.addProject("App", ""), { ok: false, error: "newer-format" });
		assert.deepEqual(await projects.updateProject("p1", "Renamed", ""), { ok: false, error: "newer-format" });
		await projects.removeProject("p1");
		assert.deepEqual(await projects.importProjects("A\nB"), { ok: false, error: "newer-format" });
		assert.equal(disk.saves(), 0);
		assert.deepEqual(
			(disk.read().projects as Json[]).map((p) => p.name),
			["Web"],
		);
	});

	it("checks the lock against the data just read, not stale memory", async () => {
		const disk = makeRawDisk({ entries: [], projects: [] });
		const store = new StateStore(disk.io);
		await store.init();
		const projects = new ProjectManager(store);
		assert.equal(projects.isLocked(), false);
		disk.replace(newerData({ formatVersion: DATA_FORMAT_VERSION + 1 }));

		assert.deepEqual(await projects.addProject("App", ""), { ok: false, error: "newer-format" });
		assert.equal(disk.saves(), 0);
		assert.equal(projects.isLocked(), true);
	});

	it("keeps entry tracking working", async () => {
		const disk = makeRawDisk(newerData({ formatVersion: DATA_FORMAT_VERSION + 1 }));
		const store = new StateStore(disk.io);
		await store.init();
		const engine = new TrackingEngine(store);
		assert.equal(await engine.start("t2", "Task 2", "b.md"), "started");
		await engine.stop();
		assert.equal((disk.read().entries as Json[]).length, 2);
	});
});
