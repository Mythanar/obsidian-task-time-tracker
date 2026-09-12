// core/TaskIdentifier.ts
// Responsibility: generate/read the inline identifier ([tt-id:: id]) on
// the task's line, and resolve its current location in the vault (or
// detect that it no longer exists).
//
// Bracketed format: it's the inline-field syntax Dataview needs to
// recognize tt-id as a structured field (without brackets, Dataview
// doesn't detect it as a field).

import { App, MarkdownView, TFile } from "obsidian";

const TASK_ID_REGEX = /\[tt-id::\s*([0-9A-Za-z]+)\]/;
// Callout/blockquote prefix: zero or more ">" (each with its own optional
// whitespace before and after), so a task inside a callout — or a nested
// callout, "> > " — is recognized the same as one outside one. Obsidian
// prepends that literal ">" to every line of the callout in the underlying
// document; it isn't stripped from line.text just because Live Preview
// renders it as a decorative bar.
const BLOCKQUOTE_PREFIX = "(?:\\s*>)*";
// Bullet: "-", "*", "+" or a numbered list ("1.", "2.", ...). The leading
// \s* covers indentation, so nested tasks are detected the same way.
const CHECKBOX_LINE_REGEX = new RegExp(`^${BLOCKQUOTE_PREFIX}\\s*(?:[-*+]|\\d+\\.)\\s*\\[.\\]\\s*(.+?)\\s*$`);
const CHECKBOX_STATE_REGEX = new RegExp(`^${BLOCKQUOTE_PREFIX}\\s*(?:[-*+]|\\d+\\.)\\s*\\[(.)\\]`);

const NANOID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const NANOID_LENGTH = 8;

// Known Tasks bug (issue #1505, see docs/DECISIONS.md and the bug note in
// the vault): Tasks only recognizes its own fields if they come AFTER the
// tt-id on the line; if the tt-id ends up behind them, Tasks stops
// recognizing all of them alike. The only reliable fix (doesn't depend on
// Tasks changing anything) is controlling where we insert the tt-id:
// always before any Tasks field present on the line.
// Full list of fields by emoji, per the official Tasks Emoji Format.
const TASKS_DATE_MARKERS = ["➕", "📅", "⏳", "🛫", "✅", "❌"];
const TASKS_PRIORITY_MARKERS = ["🔺", "⏫", "🔼", "🔽", "⏬"];

// Each pattern recognizes ONE Tasks field anchored to the end of the
// string (see findTasksMetadataStart): it only matters whether that field
// is the line's last stretch, not wherever else it appears. The
// `(?:^|\s)` separator is included in the match on purpose, so the cut
// also absorbs the space that separated it from the preceding content.
const TASKS_TRAILING_FIELD_PATTERNS: RegExp[] = [
	new RegExp(`(?:^|\\s)(?:${TASKS_DATE_MARKERS.join("|")})\\s?\\d{4}-\\d{2}-\\d{2}$`, "u"),
	new RegExp(`(?:^|\\s)(?:${TASKS_PRIORITY_MARKERS.join("|")})$`, "u"),
	/(?:^|\s)🏁\s?(?:keep|delete)$/u,
	/(?:^|\s)🆔\s?\S+$/u,
	/(?:^|\s)⛔\s?\S+$/u,
	/(?:^|\s)🔁\s?.+$/u,
];

// Walks `text` from the end backward, same as Tasks does internally, to
// find where the final contiguous block of recognized fields begins.
// Returns the cut index (length of `text` if there's no Tasks field at
// the end).
function findTasksMetadataStart(text: string): number {
	const isWhitespace = (index: number) => /\s/.test(text[index] ?? "");

	let end = text.length;
	while (end > 0 && isWhitespace(end - 1)) end--;

	let cut = true;
	while (cut) {
		cut = false;
		const current = text.slice(0, end);
		for (const pattern of TASKS_TRAILING_FIELD_PATTERNS) {
			const match = pattern.exec(current);
			if (match) {
				end = match.index;
				while (end > 0 && isWhitespace(end - 1)) end--;
				cut = true;
				break;
			}
		}
	}
	return end;
}

export function generateTaskId(): string {
	const bytes = new Uint8Array(NANOID_LENGTH);
	crypto.getRandomValues(bytes);
	let id = "";
	for (const byte of bytes) {
		id += NANOID_ALPHABET[byte % NANOID_ALPHABET.length];
	}
	return id;
}

export function extractTaskId(line: string): string | null {
	return line.match(TASK_ID_REGEX)?.[1] ?? null;
}

// Inserts (or repositions, if a previous plugin version left it
// misplaced) the tt-id right before the Tasks metadata block at the end
// of the line, or at the end if there is none. Idempotent: if `line`
// already has the tt-id correctly placed, returns an identical line.
export function appendTaskId(line: string, taskId: string): string {
	const withoutId = line.replace(TASK_ID_REGEX, "").trimEnd();
	const boundary = findTasksMetadataStart(withoutId);
	const before = withoutId.slice(0, boundary).trimEnd();
	const metadata = withoutId.slice(boundary).trim();
	const idToken = `[tt-id:: ${taskId}]`;
	return metadata.length > 0 ? `${before} ${idToken} ${metadata}` : `${before} ${idToken}`;
}

// Shared entry point for the places that start tracking a task: reuses
// the tt-id if it already existed (repositioning it if needed) or
// generates a new one. `updatedLine === line` when no change was needed,
// so the caller can avoid writing to the note unnecessarily.
export function ensureTaskId(line: string): { taskId: string; updatedLine: string } {
	const taskId = extractTaskId(line) ?? generateTaskId();
	return { taskId, updatedLine: appendTaskId(line, taskId) };
}

export function stripTaskId(text: string): string {
	return text.replace(TASK_ID_REGEX, "").trim();
}

// Checkbox state (the character inside "[ ]"), or null if the line isn't
// a checkbox. "x" (done) and "-" (cancelled) are the only states the
// plugin treats as "closed"; any other (including empty " " and custom
// Tasks states like "/") is treated as open.
export function extractCheckboxState(line: string): string | null {
	return line.match(CHECKBOX_STATE_REGEX)?.[1] ?? null;
}

export function isClosedCheckboxState(state: string | null): boolean {
	return state === "x" || state === "-";
}

// Extracts the description from a Tasks-style task line (checkbox with
// "-", "*", "+" or numbered bullet, indented or not), without the
// checkbox marker or the tt-id::. Returns null if the line isn't a
// checkbox.
export function parseCheckboxLine(line: string): string | null {
	const match = line.match(CHECKBOX_LINE_REGEX);
	if (!match) return null;
	return stripTaskId(match[1] ?? "");
}

export interface ResolvedTask {
	filePath: string;
	lineText: string;
	lineNumber: number;
}

export interface FixMisplacedTaskIdsResult {
	reviewed: number;
	fixed: number;
}

export class TaskIdentifier {
	constructor(private app: App) {}

	// Searches the vault for the first line containing the given tt-id.
	// If the same id appears on more than one line (copied to another
	// note, or duplicated), the first match is taken; that conflict
	// doesn't need resolving — all of them count as the same task for
	// accumulated time.
	async resolve(taskId: string): Promise<ResolvedTask | null> {
		return this.searchFiles(taskId, this.app.vault.getMarkdownFiles());
	}

	// Historial panel: variant of resolve() for a task card's "open note"
	// link. If the same tt-id appears in several notes (duplicates, see
	// resolve()), prioritizes the most recent session's note
	// (preferredPath, the same criterion CSV export already uses for
	// "source note": the session's snapshot, not a live search) before
	// falling back to the generic first-match-in-the-vault criterion if
	// that note no longer contains the tt-id (e.g. the task moved to
	// another note).
	async resolvePreferring(taskId: string, preferredPath: string): Promise<ResolvedTask | null> {
		const preferred = this.app.vault.getAbstractFileByPath(preferredPath);
		if (preferred instanceof TFile) {
			const found = await this.searchFiles(taskId, [preferred]);
			if (found) return found;
		}
		return this.resolve(taskId);
	}

	// When tracking stops (command, RecoveryModal, inline control, or
	// auto-stop on closing the checkbox), that same point is used to
	// reposition the tt-id if it ended up misplaced while the task was
	// running (e.g. the user hand-edited the line). Reuses appendTaskId()
	// as is; this function only decides WHERE to write the result. If the
	// note is open, it writes via the live Editor (avoids that view going
	// out of sync from a vault.process() behind its back, same reason
	// that governs searchFiles() above); otherwise it falls back to
	// vault.process() (atomic, same as fixMisplacedTaskIds()).
	async repositionTaskId(taskId: string): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) continue;
			const { editor } = leaf.view;
			for (let lineNumber = 0; lineNumber < editor.lineCount(); lineNumber++) {
				const lineText = editor.getLine(lineNumber);
				if (extractTaskId(lineText) !== taskId) continue;
				const updated = appendTaskId(lineText, taskId);
				if (updated !== lineText) editor.setLine(lineNumber, updated);
				return;
			}
		}

		const resolved = await this.resolve(taskId);
		if (!resolved) return;
		const file = this.app.vault.getAbstractFileByPath(resolved.filePath);
		if (!(file instanceof TFile)) return;

		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const lineText = lines[i];
				if (lineText === undefined || extractTaskId(lineText) !== taskId) continue;
				const updated = appendTaskId(lineText, taskId);
				if (updated === lineText) return data;
				lines[i] = updated;
				return lines.join("\n");
			}
			return data;
		});
	}

	private async searchFiles(taskId: string, files: TFile[]): Promise<ResolvedTask | null> {
		const liveContents = this.getLiveEditorContents();

		for (const file of files) {
			// The same note can be open in several leaves (split panes,
			// Edit + Read at once) with momentarily different content
			// between them — each has its own editor instance, and they
			// don't sync with each other instantly. All live candidates
			// are tried (not just one) before falling back to
			// cachedRead(): it's enough for ONE of the panes to already
			// have the tt-id in memory (e.g. the one that just started
			// tracking) to resolve it, without depending on which one is
			// iterated last.
			// If none match, it still falls back to cachedRead() (absence
			// isn't taken as proof just because the file is open): on cold
			// start, a MarkdownView can exist with its `file` already
			// assigned but the editor not yet loaded with real content
			// (an empty buffer for an instant), and that live candidate
			// must not be treated as proof the tt-id isn't there (see
			// docs/DECISIONS.md, "paneles duplicados").
			const candidates = liveContents.get(file.path) ?? [];
			const found = this.findInContents(taskId, file.path, candidates);
			if (found) return found;

			const cached = await this.app.vault.cachedRead(file);
			const foundInCache = this.findInContents(taskId, file.path, [cached]);
			if (foundInCache) return foundInCache;
		}
		return null;
	}

	// "Update tasks" button in Settings — fixes, in one pass, tasks
	// tracked with an older plugin version that may have ended up with
	// the tt-id behind Tasks' metadata (see appendTaskId()). Reuses that
	// same logic as is, no new algorithm. First checks with cachedRead()
	// whether a note needs any change before touching it: notes that are
	// already correct are never written (not even one extra
	// vault.process()), per "the user's vault is their home". Only the
	// ones that truly need it are rewritten, always with vault.process()
	// (atomic, avoids clobbering a simultaneous edit by the user or
	// another plugin on the same note).
	async fixMisplacedTaskIds(): Promise<FixMisplacedTaskIdsResult> {
		let reviewed = 0;
		let fixed = 0;

		for (const file of this.app.vault.getMarkdownFiles()) {
			const content = await this.app.vault.cachedRead(file);
			if (!content.includes("[tt-id::")) continue;

			let needsFix = false;
			for (const line of content.split("\n")) {
				const taskId = extractTaskId(line);
				if (!taskId) continue;
				reviewed++;
				if (appendTaskId(line, taskId) !== line) needsFix = true;
			}
			if (!needsFix) continue;

			await this.app.vault.process(file, (data) => {
				const lines = data.split("\n");
				for (let i = 0; i < lines.length; i++) {
					const lineText = lines[i];
					if (lineText === undefined) continue;
					const taskId = extractTaskId(lineText);
					if (!taskId) continue;
					const updated = appendTaskId(lineText, taskId);
					if (updated !== lineText) {
						lines[i] = updated;
						fixed++;
					}
				}
				return lines.join("\n");
			});
		}

		return { reviewed, fixed };
	}

	private findInContents(taskId: string, filePath: string, contents: string[]): ResolvedTask | null {
		for (const content of contents) {
			const lines = content.split("\n");
			for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
				const lineText = lines[lineNumber];
				if (lineText !== undefined && extractTaskId(lineText) === taskId) {
					return { filePath, lineText, lineNumber };
				}
			}
		}
		return null;
	}

	// Changes made via the Editor API (e.g. inserting tt-id:: when
	// tracking starts) take a moment to flush to disk, and
	// vault.cachedRead() doesn't see them until then. For open notes, the
	// editor's live content is read instead, so an actively tracked task
	// isn't marked as "not found". Returns ALL live contents per path,
	// not just one: if the same note is open in more than one leaf, each
	// can hold a different state at a given instant (see the bug
	// documented in DECISIONS.md, "paneles duplicados").
	private getLiveEditorContents(): Map<string, string[]> {
		const contents = new Map<string, string[]>();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.file) {
				const path = leaf.view.file.path;
				const existing = contents.get(path) ?? [];
				existing.push(leaf.view.editor.getValue());
				contents.set(path, existing);
			}
		}
		return contents;
	}
}
