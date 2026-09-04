// ui/DashboardView.ts
// Dashboard — panel de solo lectura con totales de una ventana fija de 30
// dias naturales (hoy + los 29 anteriores), sin selector de rango ni
// filtro (ver brief "Dashboard"). Vive en una pestana propia del
// workspace principal, nunca en el sidepanel del Historial.

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
	// Fix QA 0.0.30 — distinto de `muted`: se usa cuando el label es el
	// taskText snapshot de una tarea cuya nota de origen ya no existe. Solo
	// cursiva, sin el color atenuado de `muted` (esa tarea si existe, solo
	// falta la nota — no es lo mismo que "sin proyecto/cliente").
	italic?: boolean;
}

// Agrupa por la clave que devuelva classify(); el total de todos los
// buckets siempre suma exactamente sum(entries) porque cada entry cae en
// exactamente un bucket (ver brief: "every session belongs to exactly
// one project/client/day/task").
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

// Bloque "By day": bucket por dia calendario LOCAL de entry.start (nunca
// de entry.end) — una sesion que cruza medianoche se cuenta entera en el
// dia en que empezo, mismo criterio que ExportManager.ts y TimeLogView.ts.
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
	// Mismo guard que TimeLogView.renderToken: render() es async (resuelve
	// tt-id de "By task" leyendo el vault) y puede dispararse mas de una
	// vez seguida (refresh tras una mutacion mientras una llamada anterior
	// todavia esta resolviendo tareas).
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

		// Fix QA 0.0.30 — Por tarea: si la nota de origen ya no existe, el
		// bloque muestra igual el nombre de la tarea (taskText, snapshot
		// inmutable guardado en cada TimeEntry, ver types.ts) en cursiva, en
		// vez del generico "Tarea no encontrada" (ese texto solo sigue
		// disponible en TimeLogView.ts, fuera de este encargo).
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

	// Fix QA 0.0.30 — la nota puede haberse borrado sin que la tarea deje de
	// existir para el Dashboard: `found: false` no implica "sin label", el
	// caller cae al taskText de cada entry (siempre disponible, ver
	// types.ts) en vez de a un generico "no encontrada".
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

	// Igual que "Load more" de Resultados (ver TimeLogView.ts): el click
	// vuelve a llamar a render() completo con el cap ampliado en vez de
	// anadir filas sueltas al DOM — mismo resultado visible (nunca navega
	// ni reemplaza lo ya mostrado), pero sin mantener un segundo camino de
	// construccion de filas.
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
