import {App, PluginSettingTab, Setting} from "obsidian";
import type DrawInCanvasPlugin from "./main";
import {
	DEFAULT_SETTINGS,
	STROKE_HARDNESS_MAX,
	STROKE_HARDNESS_MIN,
	STROKE_HARDNESS_STEP,
	STROKE_OPACITY_MAX,
	STROKE_OPACITY_MIN,
	STROKE_OPACITY_STEP,
	STROKE_WIDTH_MAX,
	STROKE_WIDTH_MIN,
	STROKE_WIDTH_STEP,
	normalizeStrokeHardness,
	normalizeStrokeOpacity,
	normalizeStrokeWidth,
} from "./settings-model";

export * from "./settings-model";

export class DrawInCanvasSettingTab extends PluginSettingTab {
	plugin: DrawInCanvasPlugin;

	constructor(app: App, plugin: DrawInCanvasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		const headingEl = activeDocument.createElement("h2");
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
			.setDesc("Screen-pixel width for new freehand strokes at the current canvas zoom.")
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
			.setName("Stroke opacity")
			.setDesc("Controls how transparent new strokes are, like brush opacity.")
			.addSlider((slider) => slider
				.setLimits(STROKE_OPACITY_MIN, STROKE_OPACITY_MAX, STROKE_OPACITY_STEP)
				.setValue(normalizeStrokeOpacity(this.plugin.settings.strokeOpacity))
				.setDynamicTooltip()
				.onChange((value) => {
					this.plugin.setStrokeOpacity(value);
				}));

		new Setting(containerEl)
			.setName("Handwritten strokes")
			.setDesc("Smooth strokes with subtle tapered starts and ends. Pen strokes use real stylus pressure when available.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.beautifulStrokes)
				.onChange((value) => {
					this.plugin.setBeautifulStrokes(value);
				}));

		new Setting(containerEl)
			.setName("Stylus pointer fallback")
			.setDesc("Show a plugin pointer while drawing with a stylus when the native pointer is hidden or unreliable.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.usePenCursorFallback)
				.onChange((value) => {
					this.plugin.setPenCursorFallback(value);
				}));

		new Setting(containerEl)
			.setName("Allow tiny canvas items")
			.setDesc("Lower Obsidian's canvas item size limit so native cards, groups, and plugin strokes can be resized much smaller. Also lets native canvas zoom go past the normal zoom-in limit, adds +/− size buttons and a layer submenu to the native selection menu, and keeps shift-resizing proportional while this plugin is active.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.allowTinyCanvasElements)
				.onChange((value) => {
					this.plugin.setAllowTinyCanvasElements(value);
				}));

		const noteEl = activeDocument.createElement("p");
		noteEl.classList.add("setting-item-description");
		noteEl.textContent = "Drawings are stored inside each .canvas file as plugin JSON metadata.";
		containerEl.appendChild(noteEl);
	}
}
