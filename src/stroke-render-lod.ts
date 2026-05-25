import type {StrokeSpatialBounds} from "./stroke-spatial-index";

// Benchmarked in Obsidian at native max zoom-out (`zoom = -4`, `scale = 0.0625`):
// - Current raster overview rendering crossed the 16 ms p95 frame budget around
//   25k dense visible micro-strokes and reached ~40-70 ms by 50k-100k strokes.
// - Skipping strokes whose whole inflated bounds are below 0.5 screen px kept
//   the 25k micro-stroke overview under budget and removed all visual work for
//   marks too small to contribute a stable pixel.
// - 1 px performed similarly but removed more detail, so use the less aggressive
//   0.5 px cutoff as the benchmarked low-zoom level-of-detail threshold.
export const MIN_RENDERED_STROKE_SCREEN_SIZE = 0.5;

export function getStrokeScreenMaxDimension(bounds: StrokeSpatialBounds, screenScale: number): number {
	const width = Math.max(0, bounds.maxX - bounds.minX);
	const height = Math.max(0, bounds.maxY - bounds.minY);
	return Math.max(width, height) * screenScale;
}

export function shouldRenderStrokeAtLevelOfDetail(
	bounds: StrokeSpatialBounds,
	screenScale: number,
	isSelected = false,
	minimumScreenSize = MIN_RENDERED_STROKE_SCREEN_SIZE,
): boolean {
	if (isSelected) {
		return true;
	}

	if (!Number.isFinite(screenScale) || screenScale <= 0) {
		return true;
	}

	return getStrokeScreenMaxDimension(bounds, screenScale) >= minimumScreenSize;
}
