// types.ts
// Shared data model.
// The task<->session link is exclusively the inline tt-id:: identifier
// (see core/TaskIdentifier.ts), never the text or the path. taskText and
// filePath are immutable snapshots taken when the session starts; they
// are never rewritten afterward (not even when closing the session or
// tracking the same task from another note).

export interface TimeEntry {
	id: string;
	taskId: string;
	taskText: string;
	filePath: string;
	start: number;
	end: number | null;
}

// Projects/clients for future export adapters (Clockify and others
// expect Project/Client columns in their importer). A project's unique
// identity is the full (name, client) pair, not the name alone: two
// different clients can name their project the same way (see
// core/ProjectManager.ts). An absent client counts as its own value for
// that uniqueness (not equivalent to client: "").
export interface Project {
	id: string;
	name: string;
	client?: string;
}

// Toggl settings, manual fields (never queried via API). The date/time
// format is fixed in TogglCsvAdapter.ts, not configurable: Toggl's real
// importer requires a fixed format (YYYY-MM-DD, 24h HH:MM:SS) and doesn't
// accept a user-chosen one. If an older data.json carries dateFormat/
// timeFormat keys, they're left as unused orphaned properties: not read,
// don't break loading, not migrated.
//
// includeProjectClient is opt-in for including Project/Client columns in
// the Toggl CSV (generating those columns is a later task, gated by this
// setting). Unchecked by default: Toggl auto-creates a new Project/Client
// if the name doesn't exactly match one already in the user's account, so
// turning it on is an explicit choice, not the starting point.
export interface TogglSettings {
	email: string;
	includeProjectClient: boolean;
}

// Clockify settings, same spirit as TogglSettings: manual fields, never
// queried via API. includeProject exists on equal footing with
// includeClient — both opt-in, independent of each other, unchecked by
// default, same "clean vault by default" criterion as Toggl (see
// docs/DECISIONS.md for why Project isn't actually required).
export interface ClockifySettings {
	email: string;
	includeProject: boolean;
	includeClient: boolean;
}

// Where the Historial panel (TimeLogView) opens. Changing this setting
// doesn't move an already-open panel; it only applies the next time one
// is opened (see activateLogView() in main.ts).
export type LogViewLocation = "sidebar" | "tab";

// How the `tt-id::` inline field looks when Dataview renders it (Reading
// mode / Live Preview without the cursor on the line). Purely visual
// (class on document.body + CSS in styles.css, see
// applyTaskIdFormatClass() in main.ts); the note's source text never
// changes, and without Dataview installed it has no effect (see
// SettingsTab.ts).
export type TaskIdFormat = "normal" | "reduced" | "hidden";

export interface PluginSettings {
	toggl: TogglSettings;
	clockify: ClockifySettings;
	logViewLocation: LogViewLocation;
	// Folder inside the vault where ExportManager writes the generated
	// CSVs (both formats, generic and Toggl). Changing this setting
	// doesn't move exports already made in the previous folder; it only
	// applies from the next export onward.
	exportsFolder: string;
	taskIdFormat: TaskIdFormat;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	toggl: {
		email: "",
		includeProjectClient: false,
	},
	clockify: {
		email: "",
		includeProject: false,
		includeClient: false,
	},
	logViewLocation: "sidebar",
	exportsFolder: "task-tracker-exports",
	// "reduced" is the default on a fresh install (an explicit choice,
	// not "normal"): the full "tt-id" label Dataview renders by default
	// is visual noise for most users from the very first moment.
	taskIdFormat: "reduced",
};

// Result of editing a session's times from the Historial panel (see
// TimeLogView.ts / main.ts#updateEntryTimes). The overlap warning with
// another session is purely informational and computed live on the UI
// side while editing (see TimeLogView.ts); it never blocks saving, so
// it's not part of this result.
export type EntryUpdateResult = { ok: true } | { ok: false; error: "not-found" | "invalid-range" };

// Result of deleting a full task (its entire session history, by tt-id)
// from the Historial panel (see TimeLogView.ts / main.ts#deleteTask).
// Blocked if that task has the active session right now; the user must
// stop tracking before deleting.
export type DeleteTaskResult = { ok: true } | { ok: false; error: "active" };

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidEmail(email: string): boolean {
	return EMAIL_REGEX.test(email.trim());
}

// Task<->project link, live by tt-id (not a snapshot): if reassigned,
// that task's entire history adopts the new project instantly (see
// core/ProjectManager.ts#assignProject). Absence of a key means "no
// project assigned", not an empty value.
export type TaskProjectAssignments = Record<string, string>;

export interface PluginState {
	entries: TimeEntry[];
	settings: PluginSettings;
	projects: Project[];
	taskProjects: TaskProjectAssignments;
}
