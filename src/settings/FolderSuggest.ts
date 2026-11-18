// settings/FolderSuggest.ts
// Autocomplete of folders already existing in the vault, same UI pattern
// Obsidian uses to configure the default attachment folder. Used by the
// export folder (a path that doesn't exist yet is allowed: ExportManager
// creates it), by Tracking folders and by a project's folder. `include`
// narrows the suggestions (Tracking folders hides the vault root and the
// folders already listed; a project folder hides the folders another
// project already has). The public API has no way to add a heading inside
// the suggestion popover, so none is drawn.

import { AbstractInputSuggest, App, TFolder } from "obsidian";

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	// Whether the suggestion popover is showing, so a field's own Escape
	// handler can leave that key to the popover (see ProjectsSection.ts).
	isOpen = false;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private onChoose: (path: string) => void,
		private include: (folder: TFolder) => boolean = () => true,
	) {
		super(app, inputEl);
	}

	open(): void {
		super.open();
		this.isOpen = true;
	}

	close(): void {
		super.close();
		this.isOpen = false;
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getAllFolders(true)
			.filter((folder) => this.include(folder) && folder.path.toLowerCase().includes(q));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.onChoose(folder.path);
		this.close();
	}
}
