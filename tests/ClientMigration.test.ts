// tests/ClientMigration.test.ts
// Format 1 -> 2 (see src/core/ClientMigration.ts): clients become their own
// list assigned per task, same-name projects become one (the rest as hidden
// aliases), names that differ only in case or spaces are merged, and the
// migration is deterministic, persisted only on a real save, backed up
// first, and repeatable if an older version overwrites the data.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProjectManager } from "../src/core/ProjectManager";
import { normalizeState, normalizeStateWithReport, StateStore } from "../src/core/StateStore";
import { PluginState } from "../src/types";

type Json = Record<string, unknown>;

function makeRawDisk(initial: unknown) {
	let raw = JSON.stringify(initial);
	const backups: unknown[] = [];
	let saves = 0;
	return {
		io: {
			load: async () => JSON.parse(raw) as unknown,
			save: async (state: PluginState) => {
				saves++;
				raw = JSON.stringify(state);
			},
			backup: async (data: unknown) => {
				backups.push(data);
			},
		},
		read: () => JSON.parse(raw) as Json,
		replace: (next: unknown) => {
			raw = JSON.stringify(next);
		},
		backups,
		saves: () => saves,
	};
}

// Format-1 data as 0.0.34 or earlier writes it.
function format1(): Json {
	return {
		entries: [],
		projects: [
			{ id: "p1", name: "Web", client: "Acme" },
			{ id: "p2", name: "Web", client: "Globex" },
			{ id: "p3", name: "App" },
			{ id: "p4", name: "Docs", client: "acme " },
		],
		taskProjects: { t1: "p1", t2: "p2", t3: "p3", t4: "p4", t5: "p1" },
	};
}

// What 0.0.31-0.0.33 leave after saving format-2 data: only the fields they
// know, at every level.
function savedByOldVersion(state: Json): Json {
	const projects = (state.projects as Json[]).map(({ id, name, client }) => ({ id, name, client }));
	return { entries: state.entries, settings: state.settings, projects, taskProjects: state.taskProjects };
}

function clientNameOf(state: PluginState, taskId: string): string | undefined {
	return state.clients.find((c) => c.id === state.taskClients[taskId])?.name;
}

describe("migration to separate clients", () => {
	it("keeps each task's project and client", () => {
		const state = normalizeState(format1());
		assert.equal(state.formatVersion, 2);
		assert.deepEqual(
			state.clients.map((c) => c.name),
			["Acme", "Globex"],
		);
		assert.equal(clientNameOf(state, "t1"), "Acme");
		assert.equal(clientNameOf(state, "t2"), "Globex");
		assert.equal(clientNameOf(state, "t3"), undefined);
		// "acme " merged into "Acme" (more tasks).
		assert.equal(clientNameOf(state, "t4"), "Acme");
	});

	it("turns same-name projects into one, the rest as aliases, without rewriting assignments", () => {
		const state = normalizeState(format1());
		const p2 = state.projects.find((p) => p.id === "p2");
		assert.equal(p2?.aliasOf, "p1");
		assert.deepEqual(state.taskProjects, format1().taskProjects);
		// Frozen client text stays for older versions and a later recovery.
		assert.equal(p2?.client, "Globex");
	});

	it("merges names that differ only in case or spaces; more tasks wins, then the oldest", () => {
		const { state, migration } = normalizeStateWithReport({
			projects: [
				{ id: "a", name: "design", client: "Acme" },
				{ id: "b", name: "Design ", client: "ACME" },
				{ id: "c", name: "Café", client: "Globex" },
				{ id: "d", name: "Cafe", client: "globex" },
			],
			taskProjects: { t1: "b", t2: "b", t3: "a" },
		});
		const visible = state.projects.filter((p) => !p.aliasOf).map((p) => p.name);
		// Accents are not merged: "Café" and "Cafe" stay two projects.
		assert.deepEqual(visible, ["Design", "Café", "Cafe"]);
		assert.deepEqual(
			state.clients.map((c) => c.name),
			["ACME", "Globex"],
		);
		assert.deepEqual(migration?.projectFusions, [{ kept: "Design", merged: ["design"] }]);
		assert.deepEqual(migration?.clientFusions, [
			{ kept: "ACME", merged: ["Acme"] },
			{ kept: "Globex", merged: ["globex"] },
		]);
	});

	it("is deterministic: two reads give the same ids", () => {
		assert.deepEqual(normalizeState(format1()), normalizeState(format1()));
	});

	it("does nothing to data already in format 2", () => {
		const migrated = normalizeState(format1());
		const { state, migration } = normalizeStateWithReport(JSON.parse(JSON.stringify(migrated)));
		assert.equal(migration, null);
		// Compared as stored (JSON drops keys whose value is undefined).
		assert.deepEqual(JSON.parse(JSON.stringify(state)), JSON.parse(JSON.stringify(migrated)));
	});
});

describe("persisting the migration", () => {
	it("opening never saves; the first real save writes a backup first, once", async () => {
		const disk = makeRawDisk(format1());
		const store = new StateStore(disk.io);
		await store.init();
		assert.equal(store.getStoredFormat(), 1);
		assert.equal(disk.saves(), 0);
		assert.equal(disk.backups.length, 0);

		const manager = new ProjectManager(store);
		await manager.assignClient("t3", manager.getClients()[0]?.id ?? null);
		assert.equal(disk.backups.length, 1);
		assert.deepEqual(disk.backups[0], format1());
		assert.equal(disk.read().formatVersion, 2);
		assert.equal(store.getStoredFormat(), 2);

		await manager.assignClient("t3", null);
		assert.equal(disk.backups.length, 1);
	});

	it("recovers each task's client after an older version overwrites the data", async () => {
		const disk = makeRawDisk(format1());
		const store = new StateStore(disk.io);
		await store.init();
		await store.updateSettings((settings) => {
			settings.exportsFolder = "x";
		});
		disk.replace(savedByOldVersion(disk.read()));

		await store.reload();
		assert.equal(store.getStoredFormat(), 1);
		const state = store.getState();
		assert.equal(clientNameOf(state, "t1"), "Acme");
		assert.equal(clientNameOf(state, "t2"), "Globex");
		assert.equal(clientNameOf(state, "t4"), "Acme");
		assert.equal(new ProjectManager(store).getProjectForTask("t2")?.id, "p1");
	});
});

describe("separate client and project lists", () => {
	async function setup() {
		const disk = makeRawDisk(format1());
		const store = new StateStore(disk.io);
		await store.init();
		return { disk, store, manager: new ProjectManager(store) };
	}

	it("lists each project name once and resolves aliases", async () => {
		const { manager } = await setup();
		assert.deepEqual(
			manager.getProjects().map((p) => p.name),
			["Web", "App", "Docs"],
		);
		assert.equal(manager.getProjectForTask("t2")?.name, "Web");
		assert.equal(manager.countTasksUsing("project", "p1"), 3);
	});

	it("rejects names that differ only in case or spaces", async () => {
		const { manager } = await setup();
		assert.deepEqual(await manager.add("client", " acme"), { ok: false, error: "duplicate" });
		assert.deepEqual(await manager.add("project", "WEB"), { ok: false, error: "duplicate" });
		assert.deepEqual(await manager.add("client", "Initech"), { ok: true });
		// Paste list adds what's new and reports every name it skipped.
		assert.deepEqual(await manager.importNames("client", "Umbrella\n\numbrella\n globex \nHooli"), {
			ok: true,
			added: ["Umbrella", "Hooli"],
			skipped: ["umbrella", "globex"],
		});
		assert.deepEqual(await manager.importNames("project", "Ops\nSupport\nDesign; Josh Market"), {
			ok: true,
			added: ["Ops", "Support", "Design; Josh Market"],
			skipped: [],
		});
		assert.deepEqual(
			manager.getProjects().map((p) => p.name),
			["Web", "App", "Docs", "Ops", "Support", "Design; Josh Market"],
		);
	});

	it("renaming a project renames its aliases; a client rename keeps the frozen text", async () => {
		const { disk, manager } = await setup();
		assert.deepEqual(await manager.rename("project", "p1", "Website"), { ok: true });
		const acme = manager.getClients().find((c) => c.name === "Acme");
		assert.deepEqual(await manager.rename("client", acme?.id ?? "", "Acme Inc."), { ok: true });
		const projects = disk.read().projects as Json[];
		assert.equal(projects.find((p) => p.id === "p2")?.name, "Website");
		assert.equal(projects.find((p) => p.id === "p1")?.client, "Acme");
		assert.equal(manager.getClientForTask("t1")?.name, "Acme Inc.");
	});

	it("deleting a project removes its aliases and their assignments; deleting a client only its own", async () => {
		const { manager, store } = await setup();
		await manager.remove("project", "p1");
		assert.deepEqual(Object.keys(store.getState().taskProjects).sort(), ["t3", "t4"]);
		assert.equal(store.getState().projects.some((p) => p.id === "p2"), false);
		// Clients stay with their tasks even without a project.
		assert.equal(manager.getClientForTask("t2")?.name, "Globex");

		const globex = manager.getClients().find((c) => c.name === "Globex");
		await manager.remove("client", globex?.id ?? "");
		assert.equal(manager.getClientForTask("t2"), null);
		assert.equal(manager.getClientForTask("t1")?.name, "Acme");
	});

	it("a task can have a client and no project", async () => {
		const { manager } = await setup();
		const acme = manager.getClients().find((c) => c.name === "Acme");
		await manager.assignClient("t9", acme?.id ?? null);
		assert.equal(manager.getProjectForTask("t9"), null);
		assert.equal(manager.getClientForTask("t9")?.name, "Acme");
	});

	it("picking the project a task already has through an alias changes nothing", async () => {
		const { disk, manager, store } = await setup();
		await store.updateSettings((settings) => {
			settings.exportsFolder = "x";
		});
		const saves = disk.saves();
		await manager.assignProject("t2", "p1");
		assert.equal(disk.saves(), saves);
		assert.equal((disk.read().taskProjects as Json).t2, "p2");
	});
});
