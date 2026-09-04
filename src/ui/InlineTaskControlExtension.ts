// ui/InlineTaskControlExtension.ts
// Fase 5 — UX: icono play/stop junto al checkbox en modo Edicion
// (Live Preview / CodeMirror 6). Dibuja un widget por cada linea de tarea
// trackeable visible en el viewport; la presentacion la delega en
// InlineTaskControlView, y la reactividad en vivo (numero subiendo cada
// segundo, cambio de icono al iniciar/detener) en InlineTrackingBus — el
// widget se suscribe una vez al montarse y no depende de que CodeMirror
// vuelva a redibujar nada.
//
// El widget siempre se monta para cualquier linea de checkbox (abierta o
// cerrada); es InlineTaskControlView quien decide si se ve algo o no
// (p.ej. tarea cerrada sin historial = nada). Asi, cuando una sesion se
// cierra y una tarea cerrada pasa a tener tiempo acumulado, no hace falta
// forzar una reconstruccion de decoraciones: el propio bus.notify() (que ya
// se dispara al detener el tracking) hace que el widget existente actualice
// su badge.
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

	// Busca la posicion y el contenido actuales de la linea en el momento
	// del clic (via posAtDOM), en vez de confiar en this.lineText o en un
	// numero de linea capturado al montar el widget: si hubo ediciones por
	// encima de esta linea entre el montaje y el clic, la posicion podria
	// haber cambiado aunque el widget se haya reutilizado (eq() solo mira
	// el texto de la propia linea, no su posicion).
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
				// Anclado al final de la linea (despues de cualquier
				// contenido, incluido el tt-id::), nunca al principio: asi
				// el checkbox y el texto de la tarea no se desplazan.
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
