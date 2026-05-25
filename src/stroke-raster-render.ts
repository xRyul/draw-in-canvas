import type {StrokeSpatialBounds} from "./stroke-spatial-index.ts";
import {
	STROKE_RENDER_VIEWPORT_PADDING,
	expandStrokeRenderViewportBounds,
} from "./stroke-render-viewport.ts";

// Benchmarked in Obsidian against dense visible alternating-style stroke scenes:
// - SVG rendering crossed the 16 ms p95 frame budget between roughly 1k and 1.5k
//   visible unbatchable stroke elements, and reached ~62 ms p95 at 10k visible strokes.
// - Synchronous raster drawing stayed under budget until roughly 3.5k-4.5k strokes,
//   then crossed 16 ms p95 by about 4.5k-6k strokes on this test machine.
// - Time-sliced raster drawing with an 8 ms frame budget kept individual raster chunks
//   under the frame budget through 100k dense visible strokes; total completion time
//   scales with stroke count, but UI frames do not block on the full redraw.
// - Raster bounds must use screen-capped padding: fixed 80 canvas-unit padding created
//   tens of megapixels at high zoom, e.g. ~87 MP at zoom 5. Capping padding to 96
//   screen px keeps bitmap memory proportional to the viewport.
export const DENSE_STROKE_RASTER_RENDER_THRESHOLD = 1000;
export const CHUNKED_STROKE_RASTER_RENDER_THRESHOLD = 3500;
export const RASTER_RENDER_FRAME_BUDGET_MS = 8;
export const RASTER_RENDER_TIME_CHECK_INTERVAL = 64;
export const RASTER_RENDER_SCREEN_PADDING = 96;
export const MAX_RASTER_DEVICE_PIXEL_RATIO = 2;

export interface StrokeRasterPlanCandidate {
	id: string;
	isSelected: boolean;
}

export type StrokeRasterPlanItem =
	| {type: "single"; strokeId: string}
	| {type: "raster"; strokeIds: string[]};

export function shouldUseRasterStrokeRenderer(estimatedSvgElementCount: number): boolean {
	return estimatedSvgElementCount > DENSE_STROKE_RASTER_RENDER_THRESHOLD;
}

export function shouldUseChunkedRasterStrokeRenderer(strokeCount: number): boolean {
	return strokeCount > CHUNKED_STROKE_RASTER_RENDER_THRESHOLD;
}

export function getRasterRenderPadding(screenScale: number): number {
	if (!Number.isFinite(screenScale) || screenScale <= 0) {
		return STROKE_RENDER_VIEWPORT_PADDING;
	}

	return Math.min(STROKE_RENDER_VIEWPORT_PADDING, RASTER_RENDER_SCREEN_PADDING / screenScale);
}

export function expandRasterRenderViewportBounds(
	bounds: StrokeSpatialBounds,
	screenScale: number,
	padding = getRasterRenderPadding(screenScale),
): StrokeSpatialBounds {
	return expandStrokeRenderViewportBounds(bounds, padding);
}

export function getStrokeRasterRenderPlan(candidates: readonly StrokeRasterPlanCandidate[]): StrokeRasterPlanItem[] {
	const items: StrokeRasterPlanItem[] = [];
	let pendingRasterStrokeIds: string[] = [];

	const flushPendingRasterStrokeIds = (): void => {
		if (pendingRasterStrokeIds.length === 0) {
			return;
		}

		items.push({type: "raster", strokeIds: pendingRasterStrokeIds});
		pendingRasterStrokeIds = [];
	};

	for (const candidate of candidates) {
		if (candidate.isSelected) {
			flushPendingRasterStrokeIds();
			items.push({type: "single", strokeId: candidate.id});
			continue;
		}

		pendingRasterStrokeIds.push(candidate.id);
	}

	flushPendingRasterStrokeIds();
	return items;
}

export function getRasterDevicePixelRatio(devicePixelRatio: number): number {
	if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
		return 1;
	}

	return Math.min(devicePixelRatio, MAX_RASTER_DEVICE_PIXEL_RATIO);
}
