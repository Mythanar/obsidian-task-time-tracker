// ui/InlineTaskControlExtension.ts
// Play/stop icon next to the checkbox in Edit mode (Live Preview /
// CodeMirror 6). Draws a widget for every trackable task line visible in
// the viewport; delegates presentation to InlineTaskControlView, and
// live reactivity (the number ticking up every second, icon change on
// start/stop) to InlineTrackingBus — the widget subscribes once when it
// mounts and doesn't depend on CodeMirror redrawing anything.
//
// The widget is always mounted for any checkbox line (open or closed);
// it's InlineTaskControlView that decides whether anything is shown
// (e.g. closed task with no history = nothing). So when a session closes
// and a closed task gains accumulated time, there's no need to force a
// rebuild of decorations: bus.notify() itself (already fired when
// tracking stops) makes the existing widget update its badge.
import { editorInfoField, TFile } from "obsidian";
import { Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import {
	ensureTaskId,
	extractCheckboxState,
	extractTaskId,
	isClosedCheckboxState,
	parseCheckboxLine,
} from "../core/TaskIdentifier";
import { InlineTaskControlDeps, InlineTaskControlView } from "./InlineTaskControl";
import { InlineTrackingBus } from "./InlineTrackingBus";

export interface InlineEditorControlDeps extends InlineTaskControlDeps {
	bus: InlineTrackingBus;
	onStart: (taskId: string, taskText: string, filePath: string) => void;
	onStop: () => void;
}

class InlineTaskControlWidget extends WidgetType {
	constructor(
		private lineText: string,
		private deps: InlineEditorControlDeps,
	) {
		super();
	}

	eq(other: InlineTaskControlWidget): boolean {
		return other.lineText === this.lineText;
	}

	toDOM(view: EditorView): HTMLElement {
		const taskId = extractTaskId(this.lineText);
		const closed = isClosedCheckboxState(extractCheckboxState(this.lineText));

		let control!: InlineTaskControlView;
		control = new InlineTaskControlView(taskId, closed, this.deps, {
			onStart: () => this.handleStart(view, control),
			onStop: () => this.deps.onStop(),
		});

		const unsubscribe = this.deps.bus.subscribe(() => control.refresh());
		(control.el as HTMLElement & { _ttUnsubscribe?: () => void })._ttUnsubscribe = unsubscribe;
		return control.el;
	}

	destroy(dom: HTMLElement): void {
		(dom as HTMLElement & { _ttUnsubscribe?: () => void })._ttUnsubscribe?.();
	}

	// Looks up the line's current position and content at the moment of
	// the click (via posAtDOM), instead of trusting this.lineText or a
	// line number captured when the widget mounted: if edits happened
	// above this line between mounting and the click, the position could
	// have changed even though the widget was reused (eq() only looks at
	// the line's own text, not its position).
	private handleStart(view: EditorView, control: InlineTaskControlView): void {
		const pos = view.posAtDOM(control.el);
		const line = view.state.doc.lineAt(pos);
		const currentText = line.text;

		const taskText = parseCheckboxLine(currentText);
		if (taskText === null) return;
		if (isClosedCheckboxState(extractCheckboxState(currentText))) return;

		const { taskId, updatedLine } = ensureTaskId(currentText);
		if (updatedLine !== currentText) {
			view.dispatch({
				changes: { from: line.from, to: line.to, insert: updatedLine },
			});
		}

		const info = view.state.field(editorInfoField, false);
		const filePath = info?.file instanceof TFile ? info.file.path : "";
		this.deps.onStart(taskId, taskText, filePath);
	}
}

function buildDecorations(view: EditorView, deps: InlineEditorControlDeps): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos);
			if (parseCheckboxLine(line.text) !== null) {
				// Anchored to the end of the line (after any content,
				// including the tt-id::), never at the start: this way the
				// checkbox and the task's text never shift.
				const widgetPos = line.to;
				builder.add(
					widgetPos,
					widgetPos,
					Decoration.widget({ widget: new InlineTaskControlWidget(line.text, deps), side: 1 }),
				);
			}
			pos = line.to + 1;
		}
	}

	return builder.finish();
}

export function createInlineTaskControlExtension(deps: InlineEditorControlDeps): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, deps);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildDecorations(update.view, deps);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}
