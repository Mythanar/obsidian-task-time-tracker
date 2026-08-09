// ui/RecoveryModal.ts
// Fase 1 — recuperacion al reabrir Obsidian (US6).
// Responsabilidad: si al cargar el plugin queda una sesion marcada como
// activa de un cierre anterior, preguntar que hacer. Nunca recupera en
// silencio ni descarta el dato.

import { App, Modal } from "obsidian";
import { TimeEntry } from "../types";

export class RecoveryModal extends Modal {
	constructor(
		app: App,
		private entry: TimeEntry,
		private onCloseNow: () => void,
		private onKeepRunning: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Sesión de tracking sin cerrar" });
		contentEl.createEl("p", {
			text: `Tenías "${this.entry.taskText}" corriendo desde ${new Date(
				this.entry.start,
			).toLocaleString()}. ¿Qué quieres hacer?`,
		});

		const buttonRow = contentEl.createDiv({ cls: "task-time-tracker-recovery-buttons" });

		buttonRow.createEl("button", { text: "Cerrar ahora" }).addEventListener("click", () => {
			this.onCloseNow();
			this.close();
		});

		buttonRow
			.createEl("button", { text: "Seguir corriendo", cls: "mod-cta" })
			.addEventListener("click", () => {
				this.onKeepRunning();
				this.close();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
