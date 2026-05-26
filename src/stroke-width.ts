import {normalizeStrokeWidth} from "./settings-model.ts";
import type {CanvasStrokeHandwriting} from "./types.ts";

export function getCanvasStrokeWidthForScreenPixels(strokeWidth: unknown, screenScale: number): number {
	return getCanvasDistanceForScreenPixels(normalizeStrokeWidth(strokeWidth), screenScale);
}

export function getCanvasDistanceForScreenPixels(distance: number, screenScale: number): number {
	return normalizePositiveDistance(distance) / normalizeScreenScale(screenScale);
}

export function getCanvasStrokeHandwritingForScreenPixels(
	handwriting: CanvasStrokeHandwriting,
	screenScale: number,
): CanvasStrokeHandwriting {
	return {
		...handwriting,
		taperStart: getCanvasDistanceForScreenPixels(handwriting.taperStart, screenScale),
		taperEnd: getCanvasDistanceForScreenPixels(handwriting.taperEnd, screenScale),
	};
}

function normalizePositiveDistance(distance: number): number {
	return Number.isFinite(distance) && distance > 0 ? distance : 0;
}

function normalizeScreenScale(screenScale: number): number {
	return Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1;
}
