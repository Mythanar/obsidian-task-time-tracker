// ui/InlineTaskControl.ts
// Fase 5 — UX: badge tipo tag junto al checkbox de una tarea trackeable,
// con icono play/stop y el tiempo total acumulado. Solo modo Edicion
// (CodeMirror, ver InlineTaskControlExtension.ts): esta clase no sabe nada
// de CM6, solo dibuja el estado y delega el clic a los callbacks que le
// pasa la integracion.

import { Platform, setIcon } from "obsidian";
import { formatDuration } from "../core/TrackingEngine";
import { TimeEntry } from "../types";

export interface InlineTaskControlDeps {
	getActiveEntry: () => TimeEntry | null;
	getAccumulatedMs: (taskId: string) => number;
}

export interface InlineTaskControlHandlers {
	onStart: () => void;
	onStop: () => void;
}

// taskId y closed se toman como una foto fija tomada al montar el control:
// el control solo se remonta cuando el texto de la linea cambia (ver eq()
// en InlineTaskControlExtension.ts), asi que siguen siendo validos
// mientras el DOM viva.
export class InlineTaskControlView {
	readonly el: HTMLElement;
	private iconEl: HTMLElement;
	private dotEl: HTMLElement;
	private badgeEl: HTMLElement;

	constructor(
		private taskId: string | null,
		private closed: boolean,
		private deps: InlineTaskControlDeps,
		private handlers: InlineTaskControlHandlers,
	) {
		this.el = createSpan({ cls: "task-time-tracker-inline-control" });
		// El icono de play (tarea abierta, sin historial, no activa) solo
		// se revela por CSS al hacer :hover sobre la linea (ver
		// styles.css) — en mobile no existe hover, asi que sin esto se
		// quedaria invisible sin ninguna via para iniciar el tracking.
		// Platform.isMobile no cambia en caliente, se fija una vez al
		// montar el widget.
		this.el.toggleClass("is-mobile", Platform.isMobile);
		this.iconEl = this.el.createSpan({ cls: "task-time-tracker-inline-icon" });
		// Punto pulsante, solo visible (via CSS, ver .is-active en
		// styles.css) mientras esta tarea es la que tiene tracking activo.
		this.dotEl = this.el.createSpan({ cls: "task-time-tracker-inline-dot" });
		this.badgeEl = this.el.createSpan({ cls: "task-time-tracker-inline-badge" });

		// Evita que el mousedown mueva el cursor del editor antes de que
		// nuestro click se procese (mismo truco que usa Obsidian para sus
		// propios checkboxes interactivos en Live Preview).
		this.el.addEventListener("mousedown", (evt) => evt.preventDefault());
		this.el.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			if (this.el.hasClass("is-static")) return;

			const active = this.deps.getActiveEntry();
			if (this.taskId && active?.taskId === this.taskId) {
				this.handlers.onStop();
			} else {
				this.handlers.onStart();
			}
		});

		this.refresh();
	}

	refresh(): void {
		const active = this.deps.getActiveEntry();
		const isActiveTask = !!this.taskId && active?.taskId === this.taskId;
		const accumulatedMs = this.taskId ? this.deps.getAccumulatedMs(this.taskId) : 0;
		const hasHistory = accumulatedMs > 0;

		this.el.toggleClass("is-active", isActiveTask);
		// Con al menos una sesion guardada, el badge (icono + contador) se
		// mantiene siempre visible en vez de solo al hacer hover (ver
		// styles.css); no aplica a is-static (cerrada), que ya es siempre
		// visible por su cuenta.
		this.el.toggleClass("has-history", hasHistory);

		if (isActiveTask && active) {
			this.el.toggleClass("is-static", false);
			this.el.toggleClass("is-hidden", false);
			this.iconEl.toggleClass("is-hidden", false);
			setIcon(this.iconEl, "square");
			this.badgeEl.toggleClass("is-hidden", false);
			this.badgeEl.setText(formatDuration(accumulatedMs + (Date.now() - active.start)));
			return;
		}

		if (this.closed) {
			this.el.toggleClass("is-static", hasHistory);
			this.el.toggleClass("is-hidden", !hasHistory);
			this.iconEl.toggleClass("is-hidden", !hasHistory);
			if (hasHistory) setIcon(this.iconEl, "check");
			this.badgeEl.toggleClass("is-hidden", !hasHistory);
			if (hasHistory) this.badgeEl.setText(formatDuration(accumulatedMs));
			return;
		}

		// Tarea abierta, no activa: icono de play siempre visible; el
		// badge con el contador solo si ya tiene tiempo acumulado de
		// sesiones anteriores (en cuyo caso has-history lo mantiene
		// visible sin necesidad de hover).
		this.el.toggleClass("is-static", false);
		this.el.toggleClass("is-hidden", false);
		this.iconEl.toggleClass("is-hidden", false);
		setIcon(this.iconEl, "play");
		this.badgeEl.toggleClass("is-hidden", !hasHistory);
		if (hasHistory) this.badgeEl.setText(formatDuration(accumulatedMs));
	}
}
