import {Notice, Plugin} from "obsidian";
import {CanvasTarget, getActiveCanvasTarget} from "./canvas-target";
import {DrawingLayer, hideAllDrawInCanvasElements} from "./drawing-layer";
import {
	DEFAULT_SETTINGS,
	DrawInCanvasSettingTab,
	DrawInCanvasSettings,
	FreehandSliderSetting,
	normalizeDrawInCanvasSettings,
	normalizeFreehandSliderValue,
	normalizeStrokeHardness,
	normalizeStrokeOpacity,
	normalizeStrokeWidth,
} from "./settings";

export default class DrawInCanvasPlugin extends Plugin {
	settings: DrawInCanvasSettings = {...DEFAULT_SETTINGS};
	private activeLayer: DrawingLayer | null = null;
	private activeTarget: CanvasTarget | null = null;
	private readonly layers = new Set<DrawingLayer>();
	private isSyncing = false;
	private needsSync = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		hideAllDrawInCanvasElements(activeDocument);

		this.addCommand({
			id: "toggle-drawing-mode",
			name: "Toggle drawing mode on active canvas",
			callback: () => {
				void this.toggleDrawingMode();
			},
		});

		this.addCommand({
			id: "undo-last-stroke",
			name: "Undo last canvas drawing stroke",
			callback: () => {
				void this.undoLastStroke();
			},
		});

		this.addCommand({
			id: "redo-last-stroke",
			name: "Redo last canvas drawing stroke",
			callback: () => {
				void this.redoLastStroke();
			},
		});

		this.addCommand({
			id: "clear-drawings",
			name: "Clear drawings from active canvas",
			callback: () => {
				void this.clearActiveCanvasDrawings();
			},
		});

		this.addSettingTab(new DrawInCanvasSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			void this.syncActiveCanvasLayer();
		});

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			void this.syncActiveCanvasLayer();
		}));

		this.registerEvent(this.app.workspace.on("file-open", () => {
			void this.syncActiveCanvasLayer();
		}));
	}

	onunload(): void {
		void this.stopActiveCanvasLayer();
		hideAllDrawInCanvasElements(activeDocument);
	}

	async toggleDrawingMode(): Promise<void> {
		const layer = await this.ensureActiveCanvasLayer();

		if (!layer) {
			new Notice("Open a canvas file before enabling drawing mode.");
			return;
		}

		this.toggleLayerDrawingMode(layer);
	}

	async disableDrawingMode(_showNotice: boolean): Promise<void> {
		if (!this.activeLayer?.isDrawingEnabled()) {
			return;
		}

		this.activeLayer.disableDrawingMode();
	}

	async clearActiveCanvasDrawings(): Promise<void> {
		const layer = await this.ensureActiveCanvasLayer();

		if (!layer) {
			new Notice("Open a canvas file before clearing drawing strokes.");
			return;
		}

		await layer.clear();
		new Notice("Draw in canvas strokes cleared.");
	}

	async undoLastStroke(): Promise<void> {
		const layer = await this.ensureActiveCanvasLayer();

		if (!layer) {
			new Notice("Open a canvas file before undoing a stroke.");
			return;
		}

		const didUndo = await layer.undoLastStroke();
		new Notice(didUndo ? "Last Draw in canvas stroke removed." : "No Draw in canvas strokes to undo.");
	}

	async redoLastStroke(): Promise<void> {
		const layer = await this.ensureActiveCanvasLayer();

		if (!layer) {
			new Notice("Open a canvas file before redoing a stroke.");
			return;
		}

		const didRedo = await layer.redoLastStroke();
		new Notice(didRedo ? "Last Draw in canvas stroke restored." : "No Draw in canvas strokes to redo.");
	}

	refreshActiveLayerSettings(): void {
		for (const layer of this.layers) {
			layer.setSettings(this.settings);
		}

		this.activeLayer?.setSettings(this.settings);
	}

	setStrokeColor(color: string): void {
		this.settings.strokeColor = color;

		for (const layer of this.layers) {
			layer.setSettings(this.settings);
		}

		this.activeLayer?.setSettings(this.settings);
		void this.saveSettings();
	}

	setStrokeWidth(width: number): void {
		const strokeWidth = normalizeStrokeWidth(width);
		this.settings.strokeWidth = strokeWidth;

		for (const layer of this.layers) {
			layer.setSettings(this.settings);
		}

		this.activeLayer?.setSettings(this.settings);
		void this.saveSettings();
	}

	setStrokeHardness(hardness: number): void {
		const strokeHardness = normalizeStrokeHardness(hardness);
		this.settings.strokeHardness = strokeHardness;

		for (const layer of this.layers) {
			layer.setSettings(this.settings);
		}

		this.activeLayer?.setSettings(this.settings);
		void this.saveSettings();
	}

	setStrokeOpacity(opacity: number): void {
		const strokeOpacity = normalizeStrokeOpacity(opacity);
		this.settings.strokeOpacity = strokeOpacity;

		for (const layer of this.layers) {
			layer.setSettings(this.settings);
		}

		this.activeLayer?.setSettings(this.settings);
		void this.saveSettings();
	}

	setFreehandSliderValue(setting: FreehandSliderSetting, value: number): void {
		this.settings[setting] = normalizeFreehandSliderValue(setting, value);
		this.refreshActiveLayerSettings();
		void this.saveSettings();
	}

	setBeautifulStrokes(enabled: boolean): void {
		this.settings.beautifulStrokes = enabled;
		this.refreshActiveLayerSettings();
		void this.saveSettings();
	}

	setPenCursorFallback(enabled: boolean): void {
		this.settings.usePenCursorFallback = enabled;
		this.refreshActiveLayerSettings();
		void this.saveSettings();
	}

	setAllowTinyCanvasElements(enabled: boolean): void {
		this.settings.allowTinyCanvasElements = enabled;
		this.refreshActiveLayerSettings();
		void this.saveSettings();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeDrawInCanvasSettings(await this.loadData() as Partial<DrawInCanvasSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async ensureActiveCanvasLayer(): Promise<DrawingLayer | null> {
		await this.syncActiveCanvasLayer();
		return this.activeLayer;
	}

	private async syncActiveCanvasLayer(): Promise<void> {
		if (this.isSyncing) {
			this.needsSync = true;
			return;
		}

		this.isSyncing = true;

		try {
			do {
				this.needsSync = false;
				await this.syncActiveCanvasLayerOnce();
			} while (this.needsSync);
		} finally {
			this.isSyncing = false;
		}
	}

	private async syncActiveCanvasLayerOnce(): Promise<void> {
		const target = getActiveCanvasTarget(this.app);

		if (!target) {
			await this.stopActiveCanvasLayer();
			return;
		}

		if (this.activeLayer && this.activeTarget && isSameTarget(this.activeTarget, target)) {
			this.activeLayer.setSettings(this.settings);
			return;
		}

		await this.stopActiveCanvasLayer();

		let layer: DrawingLayer | null = null;

		try {
			layer = new DrawingLayer(this.app, target, this.settings, () => {
				this.toggleActiveLayerDrawingMode();
			}, (color) => {
				this.setStrokeColor(color);
			}, (width) => {
				this.setStrokeWidth(width);
			}, (hardness) => {
				this.setStrokeHardness(hardness);
			}, (opacity) => {
				this.setStrokeOpacity(opacity);
			}, (setting, value) => {
				this.setFreehandSliderValue(setting, value);
			}, (enabled) => {
				this.setBeautifulStrokes(enabled);
			});
			this.layers.add(layer);

			await layer.start();
			this.activeLayer = layer;
			this.activeTarget = target;
		} catch (error) {
			if (layer) {
				this.layers.delete(layer);
				await layer.stop();
			}

			console.error("Draw in canvas could not start", error);
			new Notice(`Draw in canvas could not start: ${getErrorMessage(error)}`);
		}
	}

	private toggleActiveLayerDrawingMode(): void {
		if (!this.activeLayer) {
			return;
		}

		this.toggleLayerDrawingMode(this.activeLayer);
	}

	private toggleLayerDrawingMode(layer: DrawingLayer): void {
		if (layer.isDrawingEnabled()) {
			layer.disableDrawingMode();
		} else {
			layer.enableDrawingMode();
		}

	}

	private async stopActiveCanvasLayer(): Promise<void> {
		const layers = new Set(this.layers);

		if (this.activeLayer) {
			layers.add(this.activeLayer);
		}

		this.layers.clear();
		this.activeLayer = null;
		this.activeTarget = null;

		for (const layer of layers) {
			await layer.stop();
		}

	}

}

function isSameTarget(a: CanvasTarget, b: CanvasTarget): boolean {
	return a.leaf === b.leaf && a.file.path === b.file.path;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}