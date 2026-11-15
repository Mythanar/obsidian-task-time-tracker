// core/TrackingFolders.ts
// "Tracking folders" setting: the folders where the inline play button
// shows. Pure functions only (no Obsidian API), so they can be tested.
//
// Scope of the setting: it only decides where the play button is drawn
// and where the "Start tracking on current task" command works. It never
// stops a running session, never affects the auto-stop when a task is
// closed, and never affects the History panel's play button.
//
// Paths are vault-relative folder paths without leading or trailing
// slash, as Obsidian gives them (TFolder.path). Matching is by path
// segment: "Projects/A" contains "Projects/A/x.md" and
// "Projects/A/Sub/y.md", but not "Projects/AB/z.md".

// True when filePath is the folder itself or anything below it, at any
// depth.
export function isPathInFolder(filePath: string, folder: string): boolean {
	return filePath === folder || filePath.startsWith(folder + "/");
}

// An empty list means the whole vault (the default). A listed folder
// that no longer exists stays in the list and simply matches nothing
// until a folder with the same path exists again.
export function isInTrackingFolders(filePath: string, folders: readonly string[]): boolean {
	if (folders.length === 0) return true;
	return folders.some((folder) => isPathInFolder(filePath, folder));
}

// Applies a folder rename/move (oldPath -> newPath) to the stored list,
// subpaths included. Returns null when no stored folder is affected, so
// the caller can skip the save: the same rename may arrive more than
// once (one event per descendant folder, or from another synced device)
// and must be a no-op the second time.
export function renameInFolderList(folders: readonly string[], oldPath: string, newPath: string): string[] | null {
	let changed = false;
	const next = folders.map((folder) => {
		if (!isPathInFolder(folder, oldPath)) return folder;
		changed = true;
		return newPath + folder.slice(oldPath.length);
	});
	if (!changed) return null;
	// A rename can make two entries equal (e.g. "A/B" moved onto an
	// already listed path): keep the first.
	return next.filter((folder, index) => next.indexOf(folder) === index);
}

// Defensive read of the stored value: anything that isn't a non-empty
// string is dropped, and duplicates are removed.
export function normalizeTrackingFolders(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const folders: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string" || item === "" || item === "/") continue;
		if (!folders.includes(item)) folders.push(item);
	}
	return folders;
}
