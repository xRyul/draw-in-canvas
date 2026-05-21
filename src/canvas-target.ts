import {App, TFile, View, WorkspaceLeaf} from "obsidian";

export interface CanvasTarget {
	leaf: WorkspaceLeaf;
	view: View;
	file: TFile;
	containerEl: HTMLElement;
}

type FileBackedView = View & {
	file?: TFile | null;
};

export function getActiveCanvasTarget(app: App): CanvasTarget | null {
	const leaf = app.workspace.getMostRecentLeaf();

	if (!leaf) {
		return null;
	}

	const view = leaf.view;

	if (view.getViewType() !== "canvas") {
		return null;
	}

	const file = getCanvasFile(app, view);

	if (!file || file.extension !== "canvas") {
		return null;
	}

	return {
		leaf,
		view,
		file,
		containerEl: view.containerEl,
	};
}

function getCanvasFile(app: App, view: View): TFile | null {
	const viewFile = (view as FileBackedView).file;

	if (viewFile instanceof TFile) {
		return viewFile;
	}

	const activeFile = app.workspace.getActiveFile();
	return activeFile?.extension === "canvas" ? activeFile : null;
}
