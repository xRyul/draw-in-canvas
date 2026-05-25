import {getStrokeHandwriting} from "./stroke-handwriting.ts";
import type {CanvasStroke, CanvasStrokeHandwriting} from "./types.ts";

export interface CanvasStrokeStyle {
	width: number;
	hardness: number;
	opacity: number;
	handwriting: CanvasStrokeHandwriting;
}

export function getStrokeStyle(stroke: Pick<CanvasStroke, "width" | "hardness" | "opacity" | "handwriting">): CanvasStrokeStyle {
	return {
		width: stroke.width,
		hardness: stroke.hardness,
		opacity: stroke.opacity,
		handwriting: {...getStrokeHandwriting(stroke)},
	};
}

export function setStrokeStyle(stroke: Pick<CanvasStroke, "width" | "hardness" | "opacity" | "handwriting">, style: CanvasStrokeStyle): boolean {
	const nextStyle = cloneStrokeStyle(style);

	if (areStrokeStylesEqual(getStrokeStyle(stroke), nextStyle)) {
		return false;
	}

	stroke.width = nextStyle.width;
	stroke.hardness = nextStyle.hardness;
	stroke.opacity = nextStyle.opacity;
	stroke.handwriting = nextStyle.handwriting;
	return true;
}

export function cloneStrokeStyle(style: CanvasStrokeStyle): CanvasStrokeStyle {
	return {
		...style,
		handwriting: {...style.handwriting},
	};
}

export function areStrokeStylesEqual(a: CanvasStrokeStyle, b: CanvasStrokeStyle): boolean {
	return a.width === b.width
		&& a.hardness === b.hardness
		&& a.opacity === b.opacity
		&& a.handwriting.enabled === b.handwriting.enabled
		&& a.handwriting.thinning === b.handwriting.thinning
		&& a.handwriting.streamline === b.handwriting.streamline
		&& a.handwriting.smoothing === b.handwriting.smoothing
		&& a.handwriting.taperStart === b.handwriting.taperStart
		&& a.handwriting.taperEnd === b.handwriting.taperEnd;
}
