// core/ProjectFolders.ts
// "Project by folder" (Issue #4): a project may have one optional
// folder, and every task in a note inside that folder (at any depth)
// gets that project. Pure functions only (no Obsidian API), so they can
// be tested.
//
// Rules (see the "Proyecto por carpeta" spec):
// - The folder wins: inside a project's folder, the task has that
//   project and can't be changed by hand. A manual assignment there is
//   ignored but kept in data.json, so it comes back if the folder is
//   unlinked.
// - Outside project folders, the manual assignment works as before. A
//   project is either a folder project or a manual one: a manual
//   assignment to a project that has a folder is ignored too (and kept).
// - One folder per project and one project per folder. With nested
//   folders, the most specific one wins. Matching is by path segment
//   (see TrackingFolders.ts#isPathInFolder).
// - The effective project is computed on every read, never stored, so
//   the whole history follows the current configuration.
// - The folder sets ONLY the project: the client stays independent.

import { Project } from "../types";
import { isInTrackingFolders, isPathInFolder } from "./TrackingFolders";

// An alias (see types.ts#Project.aliasOf) only counts while the project
// it points to exists; otherwise the entry is shown as a project of its
// own, so nothing is ever hidden for good by damaged data.
export function canonicalProject(projects: readonly Project[], project: Project): Project {
	if (!project.aliasOf) return project;
	return projects.find((p) => p.id === project.aliasOf && !p.aliasOf) ?? project;
}

export function visibleProjects(projects: readonly Project[]): Project[] {
	return projects.filter((p) => canonicalProject(projects, p) === p);
}

// The project whose folder holds this note, the deepest one when
// folders are nested. Only visible projects count: an alias never
// carries a folder of its own.
export function folderProjectForPath(notePath: string, projects: readonly Project[]): Project | null {
	let best: Project | null = null;
	for (const project of visibleProjects(projects)) {
		const folder = project.folder;
		if (!folder || !isPathInFolder(notePath, folder)) continue;
		if (!best || folder.length > (best.folder?.length ?? 0)) best = project;
	}
	return best;
}

export type ProjectSource = "folder" | "manual" | "none";

export interface ProjectResolution {
	project: Project | null;
	source: ProjectSource;
}

// The effective project of a task: its note's folder project, else its
// manual assignment (only if that project has no folder), else none.
// notePath null: the task's note is unknown, only the manual assignment
// can apply.
export function resolveTaskProject(
	projects: readonly Project[],
	manualProjectId: string | undefined,
	notePath: string | null,
): ProjectResolution {
	const byFolder = notePath ? folderProjectForPath(notePath, projects) : null;
	if (byFolder) return { project: byFolder, source: "folder" };
	if (manualProjectId) {
		const stored = projects.find((p) => p.id === manualProjectId);
		const manual = stored ? canonicalProject(projects, stored) : null;
		if (manual && !manual.folder) return { project: manual, source: "manual" };
	}
	return { project: null, source: "none" };
}

// Stored folder value: vault-relative, no leading or trailing slash. The
// vault root is never a project folder (it would hold every task).
export function normalizeFolderPath(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const path = raw.trim().replace(/^\/+|\/+$/g, "");
	return path === "" ? undefined : path;
}

// The project that already uses this folder, other than excludeId.
export function projectWithFolder(projects: readonly Project[], folder: string, excludeId?: string): Project | null {
	return visibleProjects(projects).find((p) => p.id !== excludeId && p.folder === folder) ?? null;
}

// Applies a folder rename/move (oldPath -> newPath) to every project
// folder at or below oldPath, in place. Returns whether anything
// changed, so the caller can skip the save: the same rename may arrive
// more than once (one event per descendant folder, or from another
// synced device).
export function renameProjectFolders(projects: Project[], oldPath: string, newPath: string): boolean {
	let changed = false;
	for (const project of projects) {
		const folder = project.folder;
		if (!folder || !isPathInFolder(folder, oldPath)) continue;
		project.folder = newPath + folder.slice(oldPath.length);
		changed = true;
	}
	return changed;
}

// Linked project folders outside the Tracking folders list, for the
// "outside" state and the notice when a Tracking folder is removed.
export function projectFoldersOutsideTracking(projects: readonly Project[], trackingFolders: readonly string[]): Set<string> {
	const outside = new Set<string>();
	for (const project of visibleProjects(projects)) {
		if (project.folder && !isInTrackingFolders(project.folder, trackingFolders)) outside.add(project.id);
	}
	return outside;
}

export interface TaskInfo {
	taskId: string;
	manualProjectId: string | undefined;
	notePath: string | null;
	// Tracked time of the whole history, for the confirmation dialog.
	trackedMs: number;
}

// What saving a new or changed folder link of `projectId` does to the
// tasks, for the confirmation dialog (D1/D2). `after` is the project
// list as it will be saved.
export interface LinkImpact {
	// Tasks that will belong to the project, and their tracked time.
	gained: number;
	gainedMs: number;
	// Of those, tasks that had another project set by hand: it is ignored
	// while the link lasts, and comes back on unlink.
	overriddenManual: number;
	// Tasks outside the folder set to this project by hand: they become
	// No project (the assignment is kept, latent).
	lostManual: number;
	// Other tasks that leave the project (they were in its old folder).
	lostOther: number;
}

export function computeLinkImpact(
	projectId: string,
	before: readonly Project[],
	after: readonly Project[],
	tasks: readonly TaskInfo[],
): LinkImpact {
	const impact: LinkImpact = { gained: 0, gainedMs: 0, overriddenManual: 0, lostManual: 0, lostOther: 0 };
	for (const task of tasks) {
		const was = resolveTaskProject(before, task.manualProjectId, task.notePath);
		const will = resolveTaskProject(after, task.manualProjectId, task.notePath);
		const wasHere = was.project?.id === projectId;
		const willBeHere = will.project?.id === projectId;
		if (willBeHere && !wasHere) {
			impact.gained++;
			impact.gainedMs += task.trackedMs;
			if (was.source === "manual") impact.overriddenManual++;
		} else if (wasHere && !willBeHere) {
			if (was.source === "manual") impact.lostManual++;
			else impact.lostOther++;
		}
	}
	return impact;
}

export function hasLinkImpact(impact: LinkImpact): boolean {
	return impact.gained + impact.lostManual + impact.lostOther > 0;
}

// A note moved or renamed (oldPath -> newPath), with the tasks it holds.
export interface NoteMove {
	oldPath: string;
	newPath: string;
	tasks: { taskId: string; manualProjectId?: string }[];
}

// Tasks whose effective project changed because their note moved, by
// new project (null = no project now), for the "3 tasks now belong to
// Project B." notice. `before` is the project list before the move
// (a folder rename also moves project folders), `after` the current one.
export function computeMoveChanges(
	before: readonly Project[],
	after: readonly Project[],
	moves: readonly NoteMove[],
): Map<Project | null, number> {
	const changes = new Map<Project | null, number>();
	const seen = new Set<string>();
	for (const move of moves) {
		for (const task of move.tasks) {
			if (seen.has(task.taskId)) continue;
			seen.add(task.taskId);
			const was = resolveTaskProject(before, task.manualProjectId, move.oldPath).project;
			const now = resolveTaskProject(after, task.manualProjectId, move.newPath).project;
			if (was?.id === now?.id) continue;
			changes.set(now, (changes.get(now) ?? 0) + 1);
		}
	}
	return changes;
}

// The part of a note path to highlight in the Edit task modal: the
// project folder's last segment, as [before, highlighted, after]. Null
// when the note isn't inside that folder.
export function splitPathAtFolder(notePath: string, folder: string): [string, string, string] | null {
	if (!isPathInFolder(notePath, folder)) return null;
	const slash = folder.lastIndexOf("/");
	const head = folder.slice(0, slash + 1);
	const segment = folder.slice(slash + 1);
	return [head, segment, notePath.slice(folder.length)];
}

// Collapsed note path for narrow screens: the first segments up to the
// project folder (when given), then "…", then the last folder and the
// file name. Returns the full path when there is nothing to collapse.
export function collapsePath(notePath: string, keepUpTo?: string): string {
	const parts = notePath.split("/");
	const keepHead = keepUpTo && isPathInFolder(notePath, keepUpTo) ? keepUpTo.split("/").length : 1;
	const keepTail = 2;
	if (parts.length <= keepHead + keepTail + 1) return notePath;
	return [...parts.slice(0, keepHead), "…", ...parts.slice(-keepTail)].join("/");
}
