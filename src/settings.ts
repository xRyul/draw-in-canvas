import {App, PluginSettingTab, Setting} from "obsidian";
import type DrawInCanvasPlugin from "./main";

export const STROKE_WIDTH_MIN = 1;
export const STROKE_WIDTH_MAX = 32;
export const STROKE_WIDTH_STEP = 1;
export const DEFAULT_STROKE_WIDTH = 4;
export const STROKE_HARDNESS_MIN = 0;
export const STROKE_HARDNESS_MAX = 100;
export const STROKE_HARDNESS_STEP = 1;
export const DEFAULT_STROKE_HARDNESS = 100;
export const FREEHAND_THINNING_MIN = -0.99;
export const FREEHAND_THINNING_MAX = 0.99;
export const FREEHAND_THINNING_STEP = 0.01;
export const DEFAULT_FREEHAND_THINNING = 0.5;
export const FREEHAND_STREAMLINE_MIN = 0.01;
export const FREEHAND_STREAMLINE_MAX = 0.99;
export const FREEHAND_STREAMLINE_STEP = 0.01;
export const DEFAULT_FREEHAND_STREAMLINE = 0.5;
export const FREEHAND_SMOOTHING_MIN = 0.01;
export const FREEHAND_SMOOTHING_MAX = 0.99;
export const FREEHAND_SMOOTHING_STEP = 0.01;
export const DEFAULT_FREEHAND_SMOOTHING = 0.5;
export const FREEHAND_TAPER_MIN = 0;
export const FREEHAND_TAPER_MAX = 100;
export const FREEHAND_TAPER_STEP = 1;
export const DEFAULT_FREEHAND_TAPER_START = 8;
export const DEFAULT_FREEHAND_TAPER_END = 8;

export const FREEHAND_SLIDER_SETTINGS = {
	strokeThinning: {
		label: "Thinning",
		min: FREEHAND_THINNING_MIN,
		max: FREEHAND_THINNING_MAX,
		step: FREEHAND_THINNING_STEP,
		defaultValue: DEFAULT_FREEHAND_THINNING,
		ariaLabel: "Stroke thinning",
	},
	strokeStreamline: {
		label: "Streamline",
		min: FREEHAND_STREAMLINE_MIN,
		max: FREEHAND_STREAMLINE_MAX,
		step: FREEHAND_STREAMLINE_STEP,
		defaultValue: DEFAULT_FREEHAND_STREAMLINE,
		ariaLabel: "Stroke streamline",
	},
	strokeSmoothing: {
		label: "Smoothing",
		min: FREEHAND_SMOOTHING_MIN,
		max: FREEHAND_SMOOTHING_MAX,
		step: FREEHAND_SMOOTHING_STEP,
		defaultValue: DEFAULT_FREEHAND_SMOOTHING,
		ariaLabel: "Stroke smoothing",
	},
	strokeTaperStart: {
		label: "Taper start",
		min: FREEHAND_TAPER_MIN,
		max: FREEHAND_TAPER_MAX,
		step: FREEHAND_TAPER_STEP,
		defaultValue: DEFAULT_FREEHAND_TAPER_START,
		ariaLabel: "Stroke taper start",
	},
	strokeTaperEnd: {
		label: "Taper end",
		min: FREEHAND_TAPER_MIN,
		max: FREEHAND_TAPER_MAX,
		step: FREEHAND_TAPER_STEP,
		defaultValue: DEFAULT_FREEHAND_TAPER_END,
		ariaLabel: "Stroke taper end",
	},
} as const;

export type FreehandSliderSetting = keyof typeof FREEHAND_SLIDER_SETTINGS;

export interface DrawInCanvasSettings {
	strokeColor: string;
	strokeWidth: number;
	strokeHardness: number;
	beautifulStrokes: boolean;
	strokeThinning: number;
	strokeStreamline: number;
	strokeSmoothing: number;
	strokeTaperStart: number;
	strokeTaperEnd: number;
}

export const DEFAULT_SETTINGS: DrawInCanvasSettings = {
	strokeColor: "#ff5a5f",
	strokeWidth: DEFAULT_STROKE_WIDTH,
	strokeHardness: DEFAULT_STROKE_HARDNESS,
	beautifulStrokes: false,
	strokeThinning: DEFAULT_FREEHAND_THINNING,
	strokeStreamline: DEFAULT_FREEHAND_STREAMLINE,
	strokeSmoothing: DEFAULT_FREEHAND_SMOOTHING,
	strokeTaperStart: DEFAULT_FREEHAND_TAPER_START,
	strokeTaperEnd: DEFAULT_FREEHAND_TAPER_END,
};

export function normalizeStrokeWidth(value: unknown): number {
	const numericValue = typeof value === "number" ? value : Number(value);

	if (!Number.isFinite(numericValue)) {
		return DEFAULT_STROKE_WIDTH;
	}

	const steppedValue = Math.round(numericValue / STROKE_WIDTH_STEP) * STROKE_WIDTH_STEP;
	return Math.min(STROKE_WIDTH_MAX, Math.max(STROKE_WIDTH_MIN, steppedValue));
}

export function normalizeStrokeHardness(value: unknown): number {
	const numericValue = typeof value === "number" ? value : Number(value);

	if (!Number.isFinite(numericValue)) {
		return DEFAULT_STROKE_HARDNESS;
	}

	const steppedValue = Math.round(numericValue / STROKE_HARDNESS_STEP) * STROKE_HARDNESS_STEP;
	return Math.min(STROKE_HARDNESS_MAX, Math.max(STROKE_HARDNESS_MIN, steppedValue));
}

export function normalizeFreehandSliderValue(setting: FreehandSliderSetting, value: unknown): number {
	const slider = FREEHAND_SLIDER_SETTINGS[setting];
	const numericValue = typeof value === "number" ? value : Number(value);

	if (!Number.isFinite(numericValue)) {
		return slider.defaultValue;
	}

	const steppedValue = Math.round(numericValue / slider.step) * slider.step;
	const clampedValue = Math.min(slider.max, Math.max(slider.min, steppedValue));
	return roundSliderValue(clampedValue, slider.step);
}

export function normalizeDrawInCanvasSettings(settings: Partial<DrawInCanvasSettings>): DrawInCanvasSettings {
	return {
		...DEFAULT_SETTINGS,
		...settings,
		strokeColor: settings.strokeColor?.trim() || DEFAULT_SETTINGS.strokeColor,
		strokeWidth: normalizeStrokeWidth(settings.strokeWidth),
		strokeHardness: normalizeStrokeHardness(settings.strokeHardness),
		beautifulStrokes: settings.beautifulStrokes === true,
		strokeThinning: normalizeFreehandSliderValue("strokeThinning", settings.strokeThinning),
		strokeStreamline: normalizeFreehandSliderValue("strokeStreamline", settings.strokeStreamline),
		strokeSmoothing: normalizeFreehandSliderValue("strokeSmoothing", settings.strokeSmoothing),
		strokeTaperStart: normalizeFreehandSliderValue("strokeTaperStart", settings.strokeTaperStart),
		strokeTaperEnd: normalizeFreehandSliderValue("strokeTaperEnd", settings.strokeTaperEnd),
	};
}

function roundSliderValue(value: number, step: number): number {
	const decimalPlaces = step.toString().split(".")[1]?.length ?? 0;
	return Number(value.toFixed(decimalPlaces));
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
			.setName("Stroke hardness")
			.setDesc("Softens new stroke edges like brush hardness.")
			.addSlider((slider) => slider
				.setLimits(STROKE_HARDNESS_MIN, STROKE_HARDNESS_MAX, STROKE_HARDNESS_STEP)
				.setValue(normalizeStrokeHardness(this.plugin.settings.strokeHardness))
				.setDynamicTooltip()
				.onChange((value) => {
					this.plugin.setStrokeHardness(value);
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
