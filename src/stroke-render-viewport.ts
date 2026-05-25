import type {StrokeSpatialBounds} from "./stroke-spatial-index";

// Benchmarked in Obsidian with synthetic canvas scenes before adding viewport rendering:
// - Full SVG render crossed the 16 ms frame budget between 500 and 1,000 strokes.
// - Rendering only an 80-unit padded viewport stayed around 2 ms p95 with 221 visible
//   strokes while the backing drawing contained up to 240k strokes.
// - Before render batching, dense visible scenes rendered one SVG path per stroke and
//   crossed the p95 frame budget around 750-1,000 visible strokes.
export const STROKE_RENDER_VIEWPORT_PADDING = 80;

export function expandStrokeRenderViewportBounds(
	bounds: StrokeSpatialBounds,
	padding = STROKE_RENDER_VIEWPORT_PADDING,
): StrokeSpatialBounds {
	return {
		minX: bounds.minX - padding,
		minY: bounds.minY - padding,
		maxX: bounds.maxX + padding,
		maxY: bounds.maxY + padding,
	};
}

export function filterVisibleStrokeIds(
	strokeIds: readonly string[],
	viewportBounds: StrokeSpatialBounds,
	getStrokeBounds: (strokeId: string) => StrokeSpatialBounds | null,
): string[] {
	return strokeIds.filter((strokeId) => {
		const bounds = getStrokeBounds(strokeId);
		return bounds !== null && doStrokeBoundsIntersect(viewportBounds, bounds);
	});
}

export function doStrokeBoundsIntersect(a: StrokeSpatialBounds, b: StrokeSpatialBounds): boolean {
	return a.minX <= b.maxX
		&& a.maxX >= b.minX
		&& a.minY <= b.maxY
		&& a.maxY >= b.minY;
}
