// ui/RecoveryModal.ts
// Responsibility: if a session is still marked active from a previous
// close when the plugin loads, ask what to do. Never recovers silently
// or discards the data.

import { App, Modal } from "obsidian";
import { t } from "../i18n";
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
		contentEl.createEl("h3", { text: t("recovery.title") });
		contentEl.createEl("p", {
			text: t("recovery.body", {
				taskText: this.entry.taskText,
				datetime: new Date(this.entry.start).toLocaleString(),
			}),
		});

		const buttonRow = contentEl.createDiv({ cls: "task-time-tracker-recovery-buttons" });

		buttonRow.createEl("button", { text: t("recovery.closeNow") }).addEventListener("click", () => {
			this.onCloseNow();
			this.close();
		});

		buttonRow
			.createEl("button", { text: t("recovery.keepGoing"), cls: "mod-cta" })
			.addEventListener("click", () => {
				this.onKeepRunning();
				this.close();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
