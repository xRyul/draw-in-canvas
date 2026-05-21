import {App, PluginSettingTab, Setting} from "obsidian";
import type DrawInCanvasPlugin from "./main";

export const STROKE_WIDTH_MIN = 1;
export const STROKE_WIDTH_MAX = 32;
export const STROKE_WIDTH_STEP = 1;
export const DEFAULT_STROKE_WIDTH = 4;

export interface DrawInCanvasSettings {
	strokeColor: string;
	strokeWidth: number;
	beautifulStrokes: boolean;
}

export const DEFAULT_SETTINGS: DrawInCanvasSettings = {
	strokeColor: "#ff5a5f",
	strokeWidth: DEFAULT_STROKE_WIDTH,
	beautifulStrokes: false,
};

export function normalizeStrokeWidth(value: unknown): number {
	const numericValue = typeof value === "number" ? value : Number(value);

	if (!Number.isFinite(numericValue)) {
		return DEFAULT_STROKE_WIDTH;
	}

	const steppedValue = Math.round(numericValue / STROKE_WIDTH_STEP) * STROKE_WIDTH_STEP;
	return Math.min(STROKE_WIDTH_MAX, Math.max(STROKE_WIDTH_MIN, steppedValue));
}

export class DrawInCanvasSettingTab extends PluginSettingTab {
	plugin: DrawInCanvasPlugin;

	constructor(app: App, plugin: DrawInCanvasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		const headingEl = document.createElement("h2");
		headingEl.textContent = "Draw in canvas";
		containerEl.appendChild(headingEl);

		new Setting(containerEl)
			.setName("Stroke color")
			.setDesc("Any CSS color, such as #ff5a5f, red, or rgb(255, 90, 95).")
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.strokeColor)
				.setValue(this.plugin.settings.strokeColor)
				.onChange(async (value) => {
					this.plugin.settings.strokeColor = value.trim() || DEFAULT_SETTINGS.strokeColor;
					this.plugin.refreshActiveLayerSettings();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Stroke width")
			.setDesc("Width of new freehand strokes in canvas units.")
			.addSlider((slider) => slider
				.setLimits(STROKE_WIDTH_MIN, STROKE_WIDTH_MAX, STROKE_WIDTH_STEP)
				.setValue(normalizeStrokeWidth(this.plugin.settings.strokeWidth))
				.setDynamicTooltip()
				.onChange((value) => {
					this.plugin.setStrokeWidth(value);
				}));

		new Setting(containerEl)
			.setName("Handwritten strokes")
			.setDesc("Smooth strokes with subtle tapered starts and ends for a more natural hand-drawn look.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.beautifulStrokes)
				.onChange((value) => {
					this.plugin.setBeautifulStrokes(value);
				}));

		const noteEl = document.createElement("p");
		noteEl.classList.add("setting-item-description");
		noteEl.textContent = "Drawings are stored inside each .canvas file as plugin JSON metadata.";
		containerEl.appendChild(noteEl);
	}
}
