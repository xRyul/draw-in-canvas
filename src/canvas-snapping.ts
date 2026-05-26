import {DEFAULT_MAX_NATIVE_CANVAS_ZOOM} from "./canvas-zoom-limits.ts";

const DEFAULT_HIGH_ZOOM_GRID_SPACING = 20;
const NATIVE_MAX_ZOOM_SCALE = 2 ** DEFAULT_MAX_NATIVE_CANVAS_ZOOM;

export function getNativeCanvasGridSpacingForTinyElements(zoom: number): number {
	if (!Number.isFinite(zoom)) {
		return DEFAULT_HIGH_ZOOM_GRID_SPACING;
	}

	if (zoom > DEFAULT_MAX_NATIVE_CANVAS_ZOOM) {
		const spacing = DEFAULT_HIGH_ZOOM_GRID_SPACING / (2 ** (zoom - DEFAULT_MAX_NATIVE_CANVAS_ZOOM));
		return Number.isFinite(spacing) && spacing > 0 ? spacing : Number.EPSILON;
	}

	return getDefaultNativeCanvasGridSpacing(zoom);
}

export function getNativeCanvasSnapDistanceForTinyElements(objectSnapDistance: number | undefined, scale: number): number {
	if (!isPositiveFiniteNumber(objectSnapDistance)) {
		return 0;
	}

	if (!isPositiveFiniteNumber(scale)) {
		return Math.ceil(objectSnapDistance);
	}

	if (scale <= NATIVE_MAX_ZOOM_SCALE) {
		return Math.ceil(objectSnapDistance / scale);
	}

	return objectSnapDistance / scale;
}

function getDefaultNativeCanvasGridSpacing(zoom: number): number {
	if (zoom < -3.3) {
		return 160;
	}

	if (zoom < -2.16) {
		return 80;
	}

	if (zoom < -0.91) {
		return 40;
	}

	return DEFAULT_HIGH_ZOOM_GRID_SPACING;
}

function isPositiveFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}
