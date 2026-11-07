// core/ClientMigration.ts
// Format 1 -> format 2: the client stops being a text inside each
// project and becomes its own list, assigned per task.
//
// Format 1: a project is a (name, client) pair, so "Web" for Acme and
// "Web" for Globex are two projects. Format 2: one "Web" project, one
// "Acme" and one "Globex" client, and each task keeps the client its
// project had.
//
// DETERMINISTIC AND IN MEMORY. normalizeState() runs this on every read
// of format-1 data (opening Obsidian never saves, see StateStore.ts), and
// the result is persisted on the next real save. Because every read
// migrates again until then, the same input must always give the same
// output, ids included: a client id picked in the UI from one read has to
// exist in the next one. So nothing here uses time or randomness.
//
// Rules (see the "Independizar Cliente de Proyecto" brief):
// - Names that differ only in case or spaces are merged ("Acme" and
//   "acme "), for clients and for projects. Never similar names.
// - The spelling with more tasks assigned wins; on a tie, the oldest one
//   (first in the list).
// - Projects with the same name become one: the oldest entry with the
//   winning spelling (the one with more tasks among those) is kept, and
//   the rest become hidden aliases of it (Project.aliasOf). Assignments
//   are not rewritten, so older plugin versions still see each task with
//   its own client.
// - The project's client text is left in place, frozen (Project.client):
//   if an older version overwrites the data, the next migration recovers
//   the clients from it.

import { Client, PluginState, Project } from "../types";

// Uniqueness key shared with ProjectManager: trims, collapses repeated
// whitespace and ignores case. Accents and other characters are kept, so
// "Café" and "Cafe" stay different (never merge similar names).
export function nameKey(name: string): string {
	return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export interface NameFusion {
	kept: string;
	merged: string[];
}

export interface MigrationReport {
	clientFusions: NameFusion[];
	projectFusions: NameFusion[];
}

// Spelling tally for one group of names sharing the same nameKey.
interface Spelling {
	raw: string;
	tasks: number;
	firstIndex: number;
}

function pickWinner(spellings: Spelling[]): Spelling {
	return spellings.reduce((best, s) =>
		s.tasks > best.tasks || (s.tasks === best.tasks && s.firstIndex < best.firstIndex) ? s : best,
	);
}

// Only spellings that still differ once trimmed count as a fusion worth
// reporting ("Acme" and "Acme " are merged silently).
function fusionOf(spellings: Spelling[], kept: string): NameFusion | null {
	const others = [...new Set(spellings.map((s) => s.raw.trim()))].filter((name) => name !== kept);
	return others.length > 0 ? { kept, merged: others } : null;
}

function addSpelling(groups: Map<string, Spelling[]>, raw: string, tasks: number, index: number): void {
	const key = nameKey(raw);
	const group = groups.get(key) ?? [];
	const existing = group.find((s) => s.raw === raw);
	if (existing) {
		existing.tasks += tasks;
	} else {
		group.push({ raw, tasks, firstIndex: index });
	}
	groups.set(key, group);
}

// FNV-1a, 32 bits: a short stable id from the client's name key.
function hashKey(key: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36).padStart(7, "0");
}

// Mutates the state in place. Expects normalized format-1 data.
export function migrateToFormat2(state: PluginState): MigrationReport {
	const report: MigrationReport = { clientFusions: [], projectFusions: [] };

	// Aliases only mean something in format 2. Format-1 data carrying one
	// was overwritten by a version that kept unknown fields (0.0.26-0.0.30):
	// the grouping below rebuilds them.
	for (const project of state.projects) delete project.aliasOf;

	const tasksPerProject = new Map<string, number>();
	for (const projectId of Object.values(state.taskProjects)) {
		tasksPerProject.set(projectId, (tasksPerProject.get(projectId) ?? 0) + 1);
	}

	// Projects: group by name key.
	const projectGroups = new Map<string, Spelling[]>();
	state.projects.forEach((project, index) => {
		addSpelling(projectGroups, project.name, tasksPerProject.get(project.id) ?? 0, index);
	});
	for (const spellings of projectGroups.values()) {
		const winner = pickWinner(spellings);
		const key = nameKey(winner.raw);
		const members = state.projects.filter((p) => nameKey(p.name) === key);
		const candidates = members.filter((p) => p.name === winner.raw);
		const canonical = candidates.reduce((best, p) =>
			(tasksPerProject.get(p.id) ?? 0) > (tasksPerProject.get(best.id) ?? 0) ? p : best,
		);
		canonical.name = winner.raw.trim();
		for (const member of members) {
			if (member !== canonical) member.aliasOf = canonical.id;
		}
		const fusion = fusionOf(spellings, canonical.name);
		if (fusion) report.projectFusions.push(fusion);
	}

	// Clients: every client text found in a project, grouped by name key.
	const clientGroups = new Map<string, Spelling[]>();
	state.projects.forEach((project, index) => {
		if (!project.client || project.client.trim() === "") return;
		addSpelling(clientGroups, project.client, tasksPerProject.get(project.id) ?? 0, index);
	});
	const clients: Client[] = [];
	const clientIdByKey = new Map<string, string>();
	const usedIds = new Set<string>();
	const orderedGroups = [...clientGroups.entries()].sort(
		(a, b) => Math.min(...a[1].map((s) => s.firstIndex)) - Math.min(...b[1].map((s) => s.firstIndex)),
	);
	for (const [key, spellings] of orderedGroups) {
		const winner = pickWinner(spellings);
		let id = `c-${hashKey(key)}`;
		for (let n = 2; usedIds.has(id); n++) id = `c-${hashKey(key)}-${n}`;
		usedIds.add(id);
		const name = winner.raw.trim();
		clients.push({ id, name });
		clientIdByKey.set(key, id);
		const fusion = fusionOf(spellings, name);
		if (fusion) report.clientFusions.push(fusion);
	}

	// Each task gets the client its project had (alias or not).
	const projectById = new Map<string, Project>(state.projects.map((p) => [p.id, p]));
	const taskClients: Record<string, string> = {};
	for (const [taskId, projectId] of Object.entries(state.taskProjects)) {
		const client = projectById.get(projectId)?.client;
		if (!client || client.trim() === "") continue;
		const clientId = clientIdByKey.get(nameKey(client));
		if (clientId) taskClients[taskId] = clientId;
	}

	state.clients = clients;
	state.taskClients = taskClients;
	return report;
}
