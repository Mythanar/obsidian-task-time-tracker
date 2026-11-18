// ui/LinkFolderModal.ts
// D1/D2: confirmation before saving a new or changed project folder that
// changes the project of some task (see core/ProjectFolders.ts
// #computeLinkImpact). Only shown when something changes. Cancel (or
// closing the dialog any other way) saves nothing. Buttons are 44 px
// tall on mobile (see styles.css).

import { App, Modal } from "obsidian";
import { LinkImpact } from "../core/ProjectFolders";
import { formatDurationCompact } from "../core/TrackingEngine";
import { t, TranslationKey } from "../i18n";

function countText(count: number, singular: TranslationKey, plural: TranslationKey, params: Record<string, string>): string {
	return t(count === 1 ? singular : plural, { ...params, count: String(count) });
}

class LinkFolderModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private projectName: string,
		private folder: string,
		private impact: LinkImpact,
		private resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, impact } = this;
		const project = this.projectName;
		this.modalEl.addClass("task-time-tracker-link-folder-modal");
		this.setTitle(t("link.title", { project }));

		contentEl.createEl("p", { text: this.folder, cls: "task-time-tracker-link-folder-path" });

		if (impact.gained > 0) {
			contentEl.createEl("p", {
				text: countText(impact.gained, "link.gainedSingular", "link.gainedPlural", {
					project,
					time: formatDurationCompact(impact.gainedMs),
				}),
			});
		}
		if (impact.overriddenManual > 0) {
			contentEl.createEl("p", {
				text: countText(impact.overriddenManual, "link.overriddenSingular", "link.overriddenPlural", { project }),
			});
		}
		if (impact.lostManual > 0) {
			contentEl.createEl("p", {
				text: countText(impact.lostManual, "link.lostManualSingular", "link.lostManualPlural", { project }),
				cls: "task-time-tracker-link-folder-warning",
			});
		}
		if (impact.lostOther > 0) {
			contentEl.createEl("p", {
				text: countText(impact.lostOther, "link.lostOtherSingular", "link.lostOtherPlural", { project }),
				cls: "task-time-tracker-link-folder-warning",
			});
		}

		const actions = contentEl.createDiv({ cls: "modal-button-container task-time-tracker-link-folder-actions" });
		actions.createEl("button", { text: t("log.cancel") }).addEventListener("click", () => this.close());
		const confirmBtn = actions.createEl("button", { text: t("link.confirm"), cls: "mod-cta" });
		confirmBtn.addEventListener("click", () => {
			this.confirmed = true;
			this.close();
		});
		confirmBtn.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(this.confirmed);
	}
}

// Resolves true only when the user confirms.
export function confirmLinkFolder(app: App, projectName: string, folder: string, impact: LinkImpact): Promise<boolean> {
	return new Promise((resolve) => new LinkFolderModal(app, projectName, folder, impact, resolve).open());
}
