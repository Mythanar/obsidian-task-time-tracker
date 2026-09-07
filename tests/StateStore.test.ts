// tests/StateStore.test.ts
// Multi-device sync safety: checks that a local operation applied to the
// latest data.json never erases foreign records that file already held
// (see src/core/StateStore.ts).
//
// The fake "disk" does a JSON round-trip on every load/save, so in-memory
// objects and on-disk objects are ALWAYS distinct: a test cannot pass by
// accident through shared references.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectManager } from "../src/core/ProjectManager";
import { normalizeState, StateStore } from "../src/core/StateStore";
import { TrackingEngine } from "../src/core/TrackingEngine";
import { PluginState, TimeEntry } from "../src/types";

interface FakeDisk {
	io: { load: () => Promise<unknown>; save: (state: PluginState) => Promise<void> };
	read: () => PluginState;
	write: (state: Partial<PluginState>) => void;
	saves: () => number;
}

function makeDisk(initial: Partial<PluginState> = {}): FakeDisk {
	let raw = JSON.stringify(normalizeState(initial));
	let saves = 0;
	return {
		io: {
			load: async () => JSON.parse(raw) as unknown,
			save: async (state: PluginState) => {
				saves++;
				raw = JSON.stringify(state);
			},
		},
		read: () => JSON.parse(raw) as PluginState,
		// Simulates what Obsidian Sync leaves on disk behind the plugin's back.
		write: (state: Partial<PluginState>) => {
			raw = JSON.stringify(normalizeState({ ...JSON.parse(raw), ...state }));
		},
		saves: () => saves,
	};
}

function entry(id: string, over: Partial<TimeEntry> = {}): TimeEntry {
	return { id, taskId: `task-${id}`, taskText: id, filePath: `${id}.md`, start: 1000, end: 2000, ...over };
}

const ids = (state: PluginState) => state.entries.map((e) => e.id);

// Leaves the store with deliberately stale in-memory state: it loads
// `stale`, and only afterwards does whatever another device already wrote
// show up on disk.
async function storeWithStaleMemory(stale: Partial<PluginState>, onDisk: Partial<PluginState>) {
	const disk = makeDisk(stale);
	const store = new StateStore(disk.io);
	await store.init();
	disk.write(onDisk);
	return { disk, store };
}

describe("normalizeState", () => {
	it("fills in defaults from any input", () => {
		for (const raw of [null, undefined, {}, 42, "x", []]) {
			const state = normalizeState(raw);
			assert.deepEqual(state.entries, []);
			assert.deepEqual(state.projects, []);
			assert.deepEqual(state.taskProjects, {});
			assert.equal(state.settings.taskIdFormat, "reduced");
			assert.equal(state.settings.exportsFolder, "task-tracker-exports");
			assert.equal(state.settings.toggl.includeProjectClient, false);
		}
	});

	it("keeps stored settings and completes the missing ones", () => {
		const state = normalizeState({ settings: { toggl: { email: "a@b.com" }, logViewLocation: "tab" } });
		assert.equal(state.settings.toggl.email, "a@b.com");
		assert.equal(state.settings.toggl.includeProjectClient, false);
		assert.equal(state.settings.logViewLocation, "tab");
		assert.equal(state.settings.clockify.email, "");
	});

	it("drops malformed records without breaking the load", () => {
		const state = normalizeState({
			entries: [entry("A"), null, { id: "B" }, { id: "C", taskId: "t", start: 1, end: null }],
			projects: [{ id: "p1", name: "P1" }, { name: "sin id" }],
			taskProjects: { taskA: "p1", taskB: 7 },
		});
		assert.deepEqual(ids(state), ["A", "C"]);
		assert.deepEqual(
			state.projects.map((p) => p.id),
			["p1"],
		);
		assert.deepEqual(state.taskProjects, { taskA: "p1" });
	});
});

describe("1. stale memory does not delete newer entries on disk", () => {
	it("adds C on top of [A, B] even though memory only had A", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ entries: [entry("A")] },
			{ entries: [entry("A"), entry("B")] },
		);
		assert.deepEqual(ids(store.getState()), ["A"]);

		await store.addEntry(entry("C"));

		assert.deepEqual(ids(disk.read()), ["A", "B", "C"]);
		assert.deepEqual(ids(store.getState()), ["A", "B", "C"]);
	});
});

describe("2. stopping a timer preserves entries delivered by sync", () => {
	it("closes A and leaves B untouched", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ entries: [entry("A", { end: null })] },
			{ entries: [entry("A", { end: null }), entry("B")] },
		);
		const engine = new TrackingEngine(store);

		const stopped = await engine.stop();

		assert.equal(stopped?.id, "A");
		const after = disk.read();
		assert.deepEqual(ids(after), ["A", "B"]);
		assert.ok(after.entries[0]!.end !== null);
		assert.equal(after.entries[1]!.end, 2000);
		assert.equal(engine.getActiveEntry(), null);
	});

	it("reconstructs the active session if disk no longer has it, instead of losing it", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ entries: [entry("A", { end: null })] },
			{ entries: [entry("B")] },
		);
		const engine = new TrackingEngine(store);

		const stopped = await engine.stop();

		assert.equal(stopped?.id, "A");
		assert.deepEqual(ids(disk.read()).sort(), ["A", "B"]);
		assert.ok(disk.read().entries.find((e) => e.id === "A")!.end !== null);
	});

	it("writes nothing when there is no active session in memory or on disk", async () => {
		const disk = makeDisk({ entries: [entry("A")] });
		const store = new StateStore(disk.io);
		await store.init();

		assert.equal(await new TrackingEngine(store).stop(), null);
		assert.equal(disk.saves(), 0);
	});
});

describe("3. editing one session leaves the others alone", () => {
	it("updates B and leaves A and C exactly as they were", async () => {
		const disk = makeDisk({ entries: [entry("A"), entry("B"), entry("C")] });
		const store = new StateStore(disk.io);
		await store.init();
		const before = disk.read();

		await store.updateEntry("B", { start: 5000, end: 9000 });

		const after = disk.read();
		assert.deepEqual(ids(after), ["A", "B", "C"]);
		assert.deepEqual(after.entries[0], before.entries[0]);
		assert.deepEqual(after.entries[2], before.entries[2]);
		assert.equal(after.entries[1]!.start, 5000);
		assert.equal(after.entries[1]!.end, 9000);
	});
});

describe("4. deleting one session deletes only that one", () => {
	it("leaves [A, C]", async () => {
		const disk = makeDisk({ entries: [entry("A"), entry("B"), entry("C")] });
		const store = new StateStore(disk.io);
		await store.init();

		assert.equal(await store.deleteEntry("B"), true);
		assert.deepEqual(ids(disk.read()), ["A", "C"]);
	});

	it("deleting a non-existent session writes nothing", async () => {
		const disk = makeDisk({ entries: [entry("A")] });
		const store = new StateStore(disk.io);
		await store.init();

		assert.equal(await store.deleteEntry("Z"), false);
		assert.equal(disk.saves(), 0);
	});
});

describe("5. stale memory does not resurrect deleted sessions", () => {
	it("adding D on top of [A, C] does not bring B back", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ entries: [entry("A"), entry("B"), entry("C")] },
			{ entries: [entry("A"), entry("C")] },
		);
		assert.deepEqual(ids(store.getState()), ["A", "B", "C"]);

		await store.addEntry(entry("D"));

		assert.deepEqual(ids(disk.read()), ["A", "C", "D"]);
		assert.deepEqual(ids(store.getState()), ["A", "C", "D"]);
	});
});

describe("6. creating a project preserves projects delivered by sync", () => {
	it("leaves P1, P2 and P3", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ projects: [{ id: "p1", name: "P1" }] },
			{ projects: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }] },
		);
		const manager = new ProjectManager(store);

		assert.deepEqual(await manager.addProject("P3", ""), { ok: true });

		assert.deepEqual(
			disk.read().projects.map((p) => p.name),
			["P1", "P2", "P3"],
		);
	});

	it("detects duplicates against disk, not against memory", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ projects: [{ id: "p1", name: "P1" }] },
			{ projects: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }] },
		);
		const manager = new ProjectManager(store);

		assert.deepEqual(await manager.addProject("P2", ""), { ok: false, error: "duplicate" });
		assert.equal(disk.read().projects.length, 2);
	});

	it("deleting a project clears only its own assignments", async () => {
		const disk = makeDisk({
			projects: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }],
			taskProjects: { taskA: "p1", taskB: "p2" },
		});
		const store = new StateStore(disk.io);
		await store.init();

		await new ProjectManager(store).removeProject("p1");

		const after = disk.read();
		assert.deepEqual(
			after.projects.map((p) => p.id),
			["p2"],
		);
		assert.deepEqual(after.taskProjects, { taskB: "p2" });
	});
});

describe("7. assigning a project preserves the other assignments", () => {
	it("adds taskC without losing taskA or taskB", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ taskProjects: { taskA: "project1" } },
			{ taskProjects: { taskA: "project1", taskB: "project2" } },
		);

		await new ProjectManager(store).assignProject("taskC", "project3");

		assert.deepEqual(disk.read().taskProjects, {
			taskA: "project1",
			taskB: "project2",
			taskC: "project3",
		});
	});

	it("unassigning removes only that key", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ taskProjects: { taskA: "project1" } },
			{ taskProjects: { taskA: "project1", taskB: "project2" } },
		);

		await new ProjectManager(store).assignProject("taskA", null);

		assert.deepEqual(disk.read().taskProjects, { taskB: "project2" });
	});
});

describe("8. external change to data.json", () => {
	it("reload() adopts the disk state without saving anything", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ entries: [entry("A")] },
			{ entries: [entry("A"), entry("B")], settings: { logViewLocation: "tab" } as never },
		);
		assert.deepEqual(ids(store.getState()), ["A"]);

		await store.reload();

		assert.deepEqual(ids(store.getState()), ["A", "B"]);
		assert.equal(store.getState().settings.logViewLocation, "tab");
		assert.equal(disk.saves(), 0);
	});
});

describe("start/stop and settings against the latest state on disk", () => {
	it("start preserves foreign entries and closes the previously active one", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ entries: [entry("A", { taskId: "t1", end: null })] },
			{ entries: [entry("A", { taskId: "t1", end: null }), entry("B")] },
		);
		const engine = new TrackingEngine(store);

		assert.equal(await engine.start("t2", "Tarea 2", "n.md"), "started");

		const after = disk.read();
		assert.deepEqual(ids(after).slice(0, 2), ["A", "B"]);
		assert.equal(after.entries.length, 3);
		assert.ok(after.entries[0]!.end !== null);
		assert.equal(after.entries[2]!.taskId, "t2");
		assert.equal(after.entries[2]!.end, null);
	});

	it("start on the already-active task writes nothing", async () => {
		const disk = makeDisk({ entries: [entry("A", { taskId: "t1", end: null })] });
		const store = new StateStore(disk.io);
		await store.init();

		assert.equal(await new TrackingEngine(store).start("t1", "Tarea 1", "n.md"), "already-active");
		assert.equal(disk.saves(), 0);
	});

	it("changing a setting does not clobber entries delivered by sync", async () => {
		const { disk, store } = await storeWithStaleMemory(
			{ entries: [entry("A")] },
			{ entries: [entry("A"), entry("B")] },
		);

		await store.updateSettings((settings) => {
			settings.exportsFolder = "otra-carpeta";
		});

		const after = disk.read();
		assert.deepEqual(ids(after), ["A", "B"]);
		assert.equal(after.settings.exportsFolder, "otra-carpeta");
	});

	it("concurrent operations serialize without losing each other", async () => {
		const disk = makeDisk({});
		const store = new StateStore(disk.io);
		await store.init();

		await Promise.all([store.addEntry(entry("A")), store.addEntry(entry("B")), store.addEntry(entry("C"))]);

		assert.deepEqual(ids(disk.read()).sort(), ["A", "B", "C"]);
	});
});
