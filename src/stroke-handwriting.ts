import type {DrawInCanvasSettings} from "./settings.ts";
import type {CanvasStroke, CanvasStrokeHandwriting} from "./types.ts";

export type StrokeHandwritingSettingsSource = Pick<DrawInCanvasSettings,
	"beautifulStrokes"
	| "strokeThinning"
	| "strokeStreamline"
	| "strokeSmoothing"
	| "strokeTaperStart"
	| "strokeTaperEnd"
>;

type StrokeHandwritingSliderSetting = Exclude<keyof StrokeHandwritingSettingsSource, "beautifulStrokes">;

// Mirrors the freehand slider limits in settings.ts without importing Obsidian UI code at runtime.
const DEFAULT_STROKE_HANDWRITING_SETTINGS: StrokeHandwritingSettingsSource = {
	beautifulStrokes: false,
	strokeThinning: 0.5,
	strokeStreamline: 0.5,
	strokeSmoothing: 0.5,
	strokeTaperStart: 8,
	strokeTaperEnd: 8,
};

const STROKE_HANDWRITING_SLIDER_SETTINGS = {
	strokeThinning: {min: -0.99, max: 0.99, step: 0.01, defaultValue: DEFAULT_STROKE_HANDWRITING_SETTINGS.strokeThinning},
	strokeStreamline: {min: 0.01, max: 0.99, step: 0.01, defaultValue: DEFAULT_STROKE_HANDWRITING_SETTINGS.strokeStreamline},
	strokeSmoothing: {min: 0.01, max: 0.99, step: 0.01, defaultValue: DEFAULT_STROKE_HANDWRITING_SETTINGS.strokeSmoothing},
	strokeTaperStart: {min: 0, max: 100, step: 1, defaultValue: DEFAULT_STROKE_HANDWRITING_SETTINGS.strokeTaperStart},
	strokeTaperEnd: {min: 0, max: 100, step: 1, defaultValue: DEFAULT_STROKE_HANDWRITING_SETTINGS.strokeTaperEnd},
} as const;

// perfect-freehand can collapse very short tapered strokes into wedge-like polygons.
// Render those as normal round centerline strokes until there is enough length for handwriting geometry.
const HANDWRITTEN_CENTERLINE_FALLBACK_STROKE_WIDTH_RATIO = 2;

export function createStrokeHandwriting(settings: StrokeHandwritingSettingsSource): CanvasStrokeHandwriting {
	return {
		enabled: settings.beautifulStrokes === true,
		thinning: normalizeStrokeHandwritingSliderValue("strokeThinning", settings.strokeThinning),
		streamline: normalizeStrokeHandwritingSliderValue("strokeStreamline", settings.strokeStreamline),
		smoothing: normalizeStrokeHandwritingSliderValue("strokeSmoothing", settings.strokeSmoothing),
		taperStart: normalizeStrokeHandwritingSliderValue("strokeTaperStart", settings.strokeTaperStart),
		taperEnd: normalizeStrokeHandwritingSliderValue("strokeTaperEnd", settings.strokeTaperEnd),
	};
}

export function normalizeStrokeHandwriting(
	value: unknown,
	fallbackSettings: StrokeHandwritingSettingsSource = DEFAULT_STROKE_HANDWRITING_SETTINGS,
): CanvasStrokeHandwriting {
	const fallback = createStrokeHandwriting(fallbackSettings);

	if (!isRecord(value)) {
		return fallback;
	}

	return {
		enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
		thinning: normalizeStrokeHandwritingSliderValue("strokeThinning", value.thinning ?? fallback.thinning),
		streamline: normalizeStrokeHandwritingSliderValue("strokeStreamline", value.streamline ?? fallback.streamline),
		smoothing: normalizeStrokeHandwritingSliderValue("strokeSmoothing", value.smoothing ?? fallback.smoothing),
		taperStart: normalizeStrokeTaperDistance(value.taperStart, fallback.taperStart),
		taperEnd: normalizeStrokeTaperDistance(value.taperEnd, fallback.taperEnd),
	};
}

export function getStrokeHandwriting(
	stroke: Pick<CanvasStroke, "handwriting"> | {handwriting?: unknown},
	fallbackSettings: StrokeHandwritingSettingsSource = DEFAULT_STROKE_HANDWRITING_SETTINGS,
): CanvasStrokeHandwriting {
	return isStrokeHandwriting(stroke.handwriting)
		? stroke.handwriting
		: normalizeStrokeHandwriting(stroke.handwriting, fallbackSettings);
}

export function isStrokeHandwriting(value: unknown): value is CanvasStrokeHandwriting {
	return isRecord(value)
		&& typeof value.enabled === "boolean"
		&& isNormalizedStrokeHandwritingSliderValue("strokeThinning", value.thinning)
		&& isNormalizedStrokeHandwritingSliderValue("strokeStreamline", value.streamline)
		&& isNormalizedStrokeHandwritingSliderValue("strokeSmoothing", value.smoothing)
		&& isStrokeTaperDistance(value.taperStart)
		&& isStrokeTaperDistance(value.taperEnd);
}

export function shouldUseHandwrittenStrokePathForLength(strokeLength: number, strokeWidth: number): boolean {
	if (!Number.isFinite(strokeLength) || !Number.isFinite(strokeWidth) || strokeWidth <= 0) {
		return true;
	}

	return strokeLength >= strokeWidth * HANDWRITTEN_CENTERLINE_FALLBACK_STROKE_WIDTH_RATIO;
}

function normalizeStrokeHandwritingSliderValue(setting: StrokeHandwritingSliderSetting, value: unknown): number {
	const slider = STROKE_HANDWRITING_SLIDER_SETTINGS[setting];
	const numericValue = typeof value === "number" ? value : Number(value);

	if (!Number.isFinite(numericValue)) {
		return slider.defaultValue;
	}

	const steppedValue = Math.round(numericValue / slider.step) * slider.step;
	const clampedValue = Math.min(slider.max, Math.max(slider.min, steppedValue));
	return roundSliderValue(clampedValue, slider.step);
}

function normalizeStrokeTaperDistance(value: unknown, fallback: number): number {
	return isStrokeTaperDistance(value) ? value : fallback;
}

function isStrokeTaperDistance(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNormalizedStrokeHandwritingSliderValue(setting: StrokeHandwritingSliderSetting, value: unknown): value is number {
	return typeof value === "number"
		&& Number.isFinite(value)
		&& normalizeStrokeHandwritingSliderValue(setting, value) === value;
}

function roundSliderValue(value: number, step: number): number {
	const decimalPlaces = step.toString().split(".")[1]?.length ?? 0;
	return Number(value.toFixed(decimalPlaces));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
