// ui/DashboardView.ts
// Dashboard — read-only panel with totals for a fixed 30-calendar-day
// window (today + the previous 29), no range selector or filter (see
// the "Dashboard" brief). Lives in its own tab in the main workspace,
// never in the Historial's sidepanel.

import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { parseCheckboxLine, TaskIdentifier } from "../core/TaskIdentifier";
import { t } from "../i18n";
import { Project, TimeEntry } from "../types";

export const DASHBOARD_VIEW_TYPE = "task-time-tracker-dashboard-view";

const WINDOW_DAYS = 30;
const INITIAL_ROWS = 5;
const PAGE_SIZE = 50;

export interface DashboardViewActions {
	getProjectForTask(taskId: string): Project | null;
	openHistory(): void;
}

function startOfDay(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

function addDays(dateAtMidnightMs: number, days: number): number {
	const d = new Date(dateAtMidnightMs);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0).getTime();
}

interface AggBucket {
	label: string;
	totalMs: number;
	count: number;
	muted: boolean;
	// Different from `muted`: used when the label is the taskText
	// snapshot of a task whose source note no longer exists. Italic only,
	// without `muted`'s dimmed color (that task does exist, only the
	// note is missing — not the same as "no project/client").
	italic?: boolean;
}

// Groups by whatever key classify() returns; the total across all
// buckets always sums to exactly sum(entries) because every entry falls
// into exactly one bucket (see the brief: "every session belongs to
// exactly one project/client/day/task").
function aggregateByKey(
	entries: TimeEntry[],
	classify: (entry: TimeEntry) => { key: string; label: string; muted?: boolean; italic?: boolean },
): AggBucket[] {
	const buckets = new Map<string, AggBucket>();
	for (const entry of entries) {
		const { key, label, muted, italic } = classify(entry);
		const durationMs = (entry.end as number) - entry.start;
		const existing = buckets.get(key);
		if (existing) {
			existing.totalMs += durationMs;
			existing.count += 1;
		} else {
			buckets.set(key, { label, totalMs: durationMs, count: 1, muted: muted ?? false, italic: italic ?? false });
		}
	}
	return [...buckets.values()].sort((a, b) => b.totalMs - a.totalMs);
}

interface DayBucket {
	dayStart: number;
	label: string;
	totalMs: number;
	count: number;
}

// "By day" block: bucketed by entry.start's LOCAL calendar day (never
// entry.end) — a session that crosses midnight counts entirely on the
// day it started, same criterion as ExportManager.ts and TimeLogView.ts.
function aggregateByDay(entries: TimeEntry[]): DayBucket[] {
	const buckets = new Map<number, DayBucket>();
	for (const entry of entries) {
		const dayStart = startOfDay(entry.start);
		const durationMs = (entry.end as number) - entry.start;
		const existing = buckets.get(dayStart);
		if (existing) {
			existing.totalMs += durationMs;
			existing.count += 1;
		} else {
			buckets.set(dayStart, { dayStart, label: formatDayLabel(dayStart), totalMs: durationMs, count: 1 });
		}
	}
	return [...buckets.values()].sort((a, b) => b.dayStart - a.dayStart);
}

function formatDayLabel(dayStart: number): string {
	return new Date(dayStart).toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export class DashboardView extends ItemView {
	private dayShown = INITIAL_ROWS;
	private taskShown = INITIAL_ROWS;
	// Same guard as TimeLogView.renderToken: render() is async (resolves
	// "By task" tt-ids by reading the vault) and can fire more than once
	// in a row (a refresh after a mutation while a previous call is
	// still resolving tasks).
	private renderToken = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private getEntries: () => TimeEntry[],
		private taskIdentifier: TaskIdentifier,
		private actions: DashboardViewActions,
	) {
		super(leaf);
	}

	getViewType(): string {
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t("dashboard.title");
	}

	getIcon(): string {
		return "bar-chart-3";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async onClose(): Promise<void> {}

	refresh(): void {
		void this.render();
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const container = this.containerEl.children[1];
		if (!container) return;
		container.empty();

		const allEntries = this.getEntries().filter((entry) => entry.end !== null);

		const header = container.createDiv({ cls: "task-time-tracker-dashboard-header" });
		const titleRow = header.createDiv({ cls: "task-time-tracker-dashboard-title-row" });
		titleRow.createEl("h1", { text: t("dashboard.title") });
		const totalEl = titleRow.createSpan({ cls: "task-time-tracker-dashboard-total" });
		const metaEl = header.createSpan({ cls: "task-time-tracker-dashboard-meta" });

		if (allEntries.length === 0) {
			totalEl.setText(formatDuration(0));
			metaEl.setText(this.formatMeta(0));
			this.renderNeverTrackedEmpty(container);
			return;
		}

		const now = Date.now();
		const windowStart = addDays(startOfDay(now), -(WINDOW_DAYS - 1));
		const windowEnd = addDays(startOfDay(now), 1);
		const windowEntries = allEntries.filter((entry) => entry.start >= windowStart && entry.start < windowEnd);
		const totalMs = windowEntries.reduce((sum, entry) => sum + ((entry.end as number) - entry.start), 0);
		totalEl.setText(formatDuration(totalMs));
		metaEl.setText(this.formatMeta(windowEntries.length));

		if (windowEntries.length === 0) {
			const lastEntry = allEntries.reduce((latest, entry) => (entry.start > latest.start ? entry : latest));
			this.renderNoRecentEmpty(container, lastEntry.start);
			return;
		}

		this.renderSimpleBlock(
			container,
			t("dashboard.byProjectHeading"),
			aggregateByKey(windowEntries, (entry) => {
				const project = this.actions.getProjectForTask(entry.taskId);
				return project
					? { key: project.id, label: project.name }
					: { key: "__none__", label: t("dashboard.noProject"), muted: true };
			}),
			t("dashboard.project.singular"),
			t("dashboard.project.plural"),
		);

		this.renderSimpleBlock(
			container,
			t("dashboard.byClientHeading"),
			aggregateByKey(windowEntries, (entry) => {
				const client = this.actions.getProjectForTask(entry.taskId)?.client;
				return client ? { key: client, label: client } : { key: "__none__", label: t("dashboard.noClient"), muted: true };
			}),
			t("dashboard.client.singular"),
			t("dashboard.client.plural"),
		);

		this.renderDayBlock(container, aggregateByDay(windowEntries));

		// By task: if the source note no longer exists, the block still
		// shows the task's name (taskText, the immutable snapshot saved
		// on every TimeEntry, see types.ts) in italics, instead of the
		// generic "Task not found" (that text is only used in
		// TimeLogView.ts).
		const taskLabels = await this.resolveTaskLabels(windowEntries);
		if (token !== this.renderToken) return;
		const taskBuckets = aggregateByKey(windowEntries, (entry) => {
			const resolved = taskLabels.get(entry.taskId);
			return { key: entry.taskId, label: resolved?.label ?? entry.taskText, italic: !resolved };
		});
		this.renderTaskBlock(container, taskBuckets);
	}

	private formatMeta(count: number): string {
		const sessionWord = count === 1 ? t("log.session.singular") : t("log.session.plural");
		return `${t("dashboard.last30Days")} · ${count} ${sessionWord}`;
	}

	// The note may have been deleted without the task ceasing to exist
	// for the Dashboard: `found: false` doesn't imply "no label", the
	// caller falls back to each entry's taskText (always available, see
	// types.ts) instead of a generic "not found".
	private async resolveTaskLabels(entries: TimeEntry[]): Promise<Map<string, { label: string; found: boolean }>> {
		const uniqueIds = [...new Set(entries.map((entry) => entry.taskId))];
		const labels = new Map<string, { label: string; found: boolean }>();
		for (const taskId of uniqueIds) {
			const resolved = await this.taskIdentifier.resolve(taskId);
			if (resolved) labels.set(taskId, { label: parseCheckboxLine(resolved.lineText) ?? resolved.lineText, found: true });
		}
		return labels;
	}

	private renderSimpleBlock(
		container: Element,
		heading: string,
		buckets: AggBucket[],
		unitSingular: string,
		unitPlural: string,
	): void {
		const block = container.createDiv({ cls: "task-time-tracker-dashboard-block" });
		const header = block.createDiv({ cls: "task-time-tracker-dashboard-block-header" });
		header.createEl("h3", { text: heading });
		const unitWord = buckets.length === 1 ? unitSingular : unitPlural;
		header.createSpan({
			cls: "task-time-tracker-dashboard-block-meta",
			text: `${buckets.length} ${unitWord}`,
		});
		for (const bucket of buckets) {
			this.renderRow(block, bucket);
		}
	}

	private renderDayBlock(container: Element, buckets: DayBucket[]): void {
		const block = container.createDiv({ cls: "task-time-tracker-dashboard-block" });
		const header = block.createDiv({ cls: "task-time-tracker-dashboard-block-header" });
		header.createEl("h3", { text: t("dashboard.byDayHeading") });
		const dayWord = buckets.length === 1 ? t("log.day.singular") : t("log.day.plural");
		const shown = Math.min(this.dayShown, buckets.length);
		header.createSpan({
			cls: "task-time-tracker-dashboard-block-meta",
			text: `${t("dashboard.last")} ${shown} ${t("dashboard.of")} ${buckets.length} ${dayWord}`,
		});
		for (const bucket of buckets.slice(0, shown)) {
			this.renderRow(block, { label: bucket.label, totalMs: bucket.totalMs, count: bucket.count, muted: false });
		}
		this.renderLoadMore(block, shown, buckets.length, (remaining) => t("dashboard.showMoreDays", { n: String(remaining) }), () => {
			this.dayShown += PAGE_SIZE;
			void this.render();
		});
	}

	private renderTaskBlock(container: Element, buckets: AggBucket[]): void {
		const block = container.createDiv({ cls: "task-time-tracker-dashboard-block" });
		const header = block.createDiv({ cls: "task-time-tracker-dashboard-block-header" });
		header.createEl("h3", { text: t("dashboard.byTaskHeading") });
		const shown = Math.min(this.taskShown, buckets.length);
		header.createSpan({
			cls: "task-time-tracker-dashboard-block-meta",
			text: `${t("dashboard.top")} ${shown} ${t("dashboard.of")} ${buckets.length} · ${t("dashboard.longestFirst")}`,
		});
		for (const bucket of buckets.slice(0, shown)) {
			this.renderRow(block, bucket);
		}
		this.renderLoadMore(
			block,
			shown,
			buckets.length,
			(remaining) => t("dashboard.showMoreTasks", { n: String(remaining) }),
			() => {
				this.taskShown += PAGE_SIZE;
				void this.render();
			},
		);
	}

	private renderRow(container: Element, bucket: AggBucket): void {
		const row = container.createDiv({ cls: "task-time-tracker-dashboard-row" });
		const nameCls = ["task-time-tracker-dashboard-row-name"];
		if (bucket.muted) nameCls.push("is-muted");
		else if (bucket.italic) nameCls.push("is-italic");
		row.createSpan({ cls: nameCls.join(" "), text: bucket.label });
		row.createSpan({ cls: "task-time-tracker-dashboard-row-duration", text: formatDuration(bucket.totalMs) });
		const sessionWord = bucket.count === 1 ? t("log.session.singular") : t("log.session.plural");
		row.createSpan({ cls: "task-time-tracker-dashboard-row-count", text: `${bucket.count} ${sessionWord}` });
	}

	// Same as Resultados's "Load more" (see TimeLogView.ts): the click
	// calls the whole render() again with the expanded cap instead of
	// appending loose rows to the DOM — same visible result (never
	// navigates or replaces what's already shown), but without keeping a
	// second row-building code path.
	private renderLoadMore(
		container: Element,
		shown: number,
		total: number,
		linkText: (remaining: number) => string,
		onClick: () => void,
	): void {
		const remaining = total - shown;
		if (remaining <= 0) return;

		const wrap = container.createDiv({ cls: "task-time-tracker-dashboard-load-more" });
		const link = wrap.createSpan({
			cls: "task-time-tracker-dashboard-load-more-link",
			text: linkText(Math.min(PAGE_SIZE, remaining)),
		});
		link.addEventListener("click", onClick);
		wrap.createSpan({
			cls: "task-time-tracker-dashboard-load-more-count",
			text: t("dashboard.shownOfCount", { shown: String(shown), count: String(total) }),
		});
	}

	private renderNeverTrackedEmpty(container: Element): void {
		const wrap = container.createDiv({ cls: "task-time-tracker-dashboard-empty" });
		wrap.createEl("p", { cls: "task-time-tracker-dashboard-empty-title", text: t("dashboard.emptyNeverTitle") });
		wrap.createEl("p", { cls: "task-time-tracker-dashboard-empty-body", text: t("dashboard.emptyNeverBody") });
		const button = wrap.createEl("button", { text: t("dashboard.emptyNeverButton") });
		button.addEventListener("click", () => new Notice(t("dashboard.emptyNeverNotice")));
	}

	private renderNoRecentEmpty(container: Element, lastSessionStart: number): void {
		const wrap = container.createDiv({ cls: "task-time-tracker-dashboard-empty" });
		wrap.createEl("p", { cls: "task-time-tracker-dashboard-empty-title", text: t("dashboard.emptyRecentTitle") });
		const dateLabel = new Date(lastSessionStart).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
		wrap.createEl("p", {
			cls: "task-time-tracker-dashboard-empty-body",
			text: t("dashboard.emptyRecentBody", { date: dateLabel }),
		});
		const button = wrap.createEl("button", { text: t("dashboard.emptyRecentButton") });
		button.addEventListener("click", () => this.actions.openHistory());
	}
}
