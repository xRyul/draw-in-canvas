import type {DrawInCanvasSettings} from "./settings";
import type {CanvasStroke, StrokePoint} from "./types";

// Benchmarked in Obsidian after SVG batching, raster fallback, and tiled raster cache:
// - Rebuilding same-style batched SVG path data crossed the 16 ms p95 budget around
//   8k visible 32-point strokes; cached per-stroke path data kept the same workload
//   under budget on warm redraws.
// - Handwritten raster redraws crossed the 16 ms p95 budget around 1k pressure strokes
//   because each redraw recomputed perfect-freehand outlines and Path2D objects; cached
//   Path2D lookups now run before path-data lookup, avoiding warm redraw string/cache
//   churn and keeping the measured 2k-stroke handwritten raster p95 under budget.
// - Linear raster Path2D caching was not adopted because benchmarks showed inconsistent
//   warm p95 and GC spikes; linear raster drawing stays on the direct Canvas path loop.
export const MAX_CACHED_STROKE_PATH_DATA = 20_000;
export const MAX_CACHED_STROKE_RASTER_PATHS = 8_192;

export type StrokePathCacheKind = "linear" | "handwritten";

export interface StrokePathCacheKeyOptions {
	kind: StrokePathCacheKind;
	settings: DrawInCanvasSettings;
	isComplete?: boolean;
	hasPressure?: boolean;
	isStart?: boolean;
	isEnd?: boolean;
}

export class StrokePathCache {
	private readonly pathDataByKey = new Map<string, string>();
	private readonly rasterPathByKey = new Map<string, unknown>();
	private readonly pathDataKeysByStrokeId = new Map<string, Set<string>>();
	private readonly rasterPathKeysByStrokeId = new Map<string, Set<string>>();
	private readonly maxPathDataEntries: number;
	private readonly maxRasterPathEntries: number;

	constructor(
		maxPathDataEntries = MAX_CACHED_STROKE_PATH_DATA,
		maxRasterPathEntries = MAX_CACHED_STROKE_RASTER_PATHS,
	) {
		this.maxPathDataEntries = maxPathDataEntries;
		this.maxRasterPathEntries = maxRasterPathEntries;
	}

	getPathData(strokeId: string, key: string, createPathData: () => string): string {
		if (this.maxPathDataEntries <= 0) {
			return createPathData();
		}

		const cachedPathData = this.pathDataByKey.get(key);

		if (cachedPathData !== undefined) {
			return cachedPathData;
		}

		const pathData = createPathData();
		this.pathDataByKey.set(key, pathData);
		rememberStrokeCacheKey(this.pathDataKeysByStrokeId, strokeId, key);
		this.evictOldestPathDataEntries();
		return pathData;
	}

	getRasterPath<T>(strokeId: string, key: string, createRasterPath: () => T): T {
		if (this.maxRasterPathEntries <= 0) {
			return createRasterPath();
		}

		const cachedRasterPath = this.rasterPathByKey.get(key) as T | undefined;

		if (cachedRasterPath !== undefined) {
			return cachedRasterPath;
		}

		const rasterPath = createRasterPath();
		this.rasterPathByKey.set(key, rasterPath);
		rememberStrokeCacheKey(this.rasterPathKeysByStrokeId, strokeId, key);
		this.evictOldestRasterPathEntries();
		return rasterPath;
	}

	invalidateStroke(strokeId: string): void {
		deleteStrokeCacheKeys(this.pathDataByKey, this.pathDataKeysByStrokeId, strokeId);
		deleteStrokeCacheKeys(this.rasterPathByKey, this.rasterPathKeysByStrokeId, strokeId);
	}

	clear(): void {
		this.pathDataByKey.clear();
		this.rasterPathByKey.clear();
		this.pathDataKeysByStrokeId.clear();
		this.rasterPathKeysByStrokeId.clear();
	}

	getPathDataEntryCount(): number {
		return this.pathDataByKey.size;
	}

	getRasterPathEntryCount(): number {
		return this.rasterPathByKey.size;
	}

	private evictOldestPathDataEntries(): void {
		evictOldestEntries(this.pathDataByKey, this.pathDataKeysByStrokeId, this.maxPathDataEntries);
	}

	private evictOldestRasterPathEntries(): void {
		evictOldestEntries(this.rasterPathByKey, this.rasterPathKeysByStrokeId, this.maxRasterPathEntries);
	}
}

export function createStrokePathCacheKey(stroke: CanvasStroke, options: StrokePathCacheKeyOptions): string {
	return [
		stroke.id,
		options.kind,
		getStrokeGeometryRevision(stroke),
		getStrokePathSettingsKey(options),
	].join("|");
}

function getStrokeGeometryRevision(stroke: CanvasStroke): string {
	const firstPoint = stroke.points[0];
	const lastPoint = stroke.points[stroke.points.length - 1];

	return [
		stroke.points.length,
		formatPointRevision(firstPoint),
		formatPointRevision(lastPoint),
		stroke.width,
	].join(":");
}

function formatPointRevision(point: StrokePoint | undefined): string {
	if (!point) {
		return "";
	}

	return [point.x, point.y, point.pressure ?? ""].join(",");
}

function getStrokePathSettingsKey(options: StrokePathCacheKeyOptions): string {
	if (options.kind === "linear") {
		return options.settings.beautifulStrokes ? "smooth" : "linear";
	}

	return [
		options.isComplete ?? true,
		options.hasPressure ?? false,
		options.isStart ?? true,
		options.isEnd ?? true,
		options.settings.strokeThinning,
		options.settings.strokeSmoothing,
		options.settings.strokeStreamline,
		options.settings.strokeTaperStart,
		options.settings.strokeTaperEnd,
	].join(":");
}


function rememberStrokeCacheKey(keysByStrokeId: Map<string, Set<string>>, strokeId: string, key: string): void {
	let keys = keysByStrokeId.get(strokeId);

	if (!keys) {
		keys = new Set<string>();
		keysByStrokeId.set(strokeId, keys);
	}

	keys.add(key);
}

function evictOldestEntries<T>(map: Map<string, T>, keysByStrokeId: Map<string, Set<string>>, maxEntries: number): void {
	while (map.size > maxEntries) {
		const oldestKey = map.keys().next().value as string | undefined;

		if (oldestKey === undefined) {
			return;
		}

		map.delete(oldestKey);
		forgetCacheKey(keysByStrokeId, oldestKey);
	}
}

function deleteStrokeCacheKeys<T>(map: Map<string, T>, keysByStrokeId: Map<string, Set<string>>, strokeId: string): void {
	const keys = keysByStrokeId.get(strokeId);

	if (!keys) {
		return;
	}

	for (const key of keys) {
		map.delete(key);
	}

	keysByStrokeId.delete(strokeId);
}

function forgetCacheKey(keysByStrokeId: Map<string, Set<string>>, key: string): void {
	const strokeId = key.split("|", 1)[0];

	if (!strokeId) {
		return;
	}

	const keys = keysByStrokeId.get(strokeId);

	if (!keys) {
		return;
	}

	keys.delete(key);

	if (keys.size === 0) {
		keysByStrokeId.delete(strokeId);
	}
}
