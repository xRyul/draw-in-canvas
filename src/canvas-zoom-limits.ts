export const DEFAULT_MIN_NATIVE_CANVAS_ZOOM = -4;
export const DEFAULT_MAX_NATIVE_CANVAS_ZOOM = 1;

// Performance benchmark: a dense scene with 4,000 visible plugin strokes / 8,000 SVG paths stayed
// at 60fps through zoom 12; zoom 13 introduced 30fps frames and zoom 18 dropped to ~10fps.
export const EXTENDED_MAX_NATIVE_CANVAS_ZOOM = 12;
export const EXTENDED_MAX_NATIVE_CANVAS_SCALE = 2 ** EXTENDED_MAX_NATIVE_CANVAS_ZOOM;

export function clampNativeCanvasZoomForTinyElements(zoom: number): number {
	if (!Number.isFinite(zoom)) {
		return zoom > 0 ? EXTENDED_MAX_NATIVE_CANVAS_ZOOM : DEFAULT_MIN_NATIVE_CANVAS_ZOOM;
	}

	return Math.min(
		EXTENDED_MAX_NATIVE_CANVAS_ZOOM,
		Math.max(DEFAULT_MIN_NATIVE_CANVAS_ZOOM, zoom),
	);
}

export function clampNativeCanvasScaleForTinyElements(scale: number): number {
	const minScale = 2 ** DEFAULT_MIN_NATIVE_CANVAS_ZOOM;

	if (!Number.isFinite(scale)) {
		return scale > 0 ? EXTENDED_MAX_NATIVE_CANVAS_SCALE : minScale;
	}

	return Math.min(
		EXTENDED_MAX_NATIVE_CANVAS_SCALE,
		Math.max(minScale, scale),
	);
}
