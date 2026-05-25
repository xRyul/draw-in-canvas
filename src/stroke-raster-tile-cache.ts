import type {StrokeSpatialBounds} from "./stroke-spatial-index.ts";

// Benchmarked in Obsidian against dense panning scenes after the chunked bitmap renderer:
// - Full viewport raster redraws stayed interactive at ~12k visible strokes but needed
//   ~85 ms total redraw time; by ~50k visible strokes the synchronous setup crossed
//   the 16 ms frame budget and total redraw time was ~450-500 ms.
// - A 128 px tile target reused unchanged tiles while panning. It kept warm pan setup
//   bounded by newly exposed tiles instead of all visible strokes, and avoided high-zoom
//   bitmap explosions by shrinking world tile size as screen scale increases.
// - Cold tile setup degraded past the 8 ms setup budget around 100k dense visible
//   strokes. Time-slicing setup with a 7.5 ms budget kept measured setup chunks
//   below 8 ms through 300k dense visible strokes on the same scene.
// - Single-stroke edits in a warm 88-tile dense scene currently forced a full cold
//   cache rebuild: ~306 ms at 20k strokes, ~1.9 s at 50k, ~3.6 s at 100k,
//   and ~7.2 s at 200k. Prototype incremental invalidation of the 1-2
//   intersecting tiles kept the same edits around ~21 ms, ~47 ms, ~57 ms,
//   and ~104 ms respectively, so mutation paths should invalidate only affected tiles.
export const RASTER_TILE_SCREEN_SIZE = 128;
export const TILED_RASTER_CACHE_STROKE_THRESHOLD = 10_000;
export const MAX_RASTER_TILE_CACHE_TILES = 512;
export const RASTER_TILE_SETUP_FRAME_BUDGET_MS = 7.5;
export const RASTER_TILE_SETUP_TIME_CHECK_INTERVAL = 64;

export interface RasterTileCoordinate {
	tileX: number;
	tileY: number;
}

export interface RasterTileEntry extends RasterTileCoordinate {
	key: string;
	bounds: StrokeSpatialBounds;
}

export interface RasterTileStrokeCandidate {
	id: string;
	bounds: StrokeSpatialBounds;
}

export interface RasterTileRange {
	minTileX: number;
	maxTileX: number;
	minTileY: number;
	maxTileY: number;
}

export function shouldUseTiledRasterCache(visibleStrokeCount: number, hasSelectedStrokes: boolean): boolean {
	return !hasSelectedStrokes
		&& Number.isFinite(visibleStrokeCount)
		&& visibleStrokeCount > TILED_RASTER_CACHE_STROKE_THRESHOLD;
}

export function getRasterTileWorldSize(screenScale: number, tileScreenSize = RASTER_TILE_SCREEN_SIZE): number {
	if (!Number.isFinite(screenScale) || screenScale <= 0) {
		return tileScreenSize;
	}

	return tileScreenSize / screenScale;
}

export function getRasterTileKey(tileX: number, tileY: number, tileWorldSize: number, rasterScale: number): string {
	return [tileX, tileY, roundTileNumber(tileWorldSize), roundTileNumber(rasterScale)].join(",");
}

export function getRasterTileBounds(tile: RasterTileCoordinate, tileWorldSize: number): StrokeSpatialBounds {
	return {
		minX: tile.tileX * tileWorldSize,
		minY: tile.tileY * tileWorldSize,
		maxX: tile.tileX * tileWorldSize + tileWorldSize,
		maxY: tile.tileY * tileWorldSize + tileWorldSize,
	};
}

export function getRasterTileEntries(
	bounds: StrokeSpatialBounds,
	tileWorldSize: number,
	rasterScale: number,
): RasterTileEntry[] {
	if (!isValidTileInput(bounds, tileWorldSize)) {
		return [];
	}

	const range = getRasterTileRange(bounds, tileWorldSize);
	const entries: RasterTileEntry[] = [];

	for (let tileY = range.minTileY; tileY <= range.maxTileY; tileY++) {
		for (let tileX = range.minTileX; tileX <= range.maxTileX; tileX++) {
			const tile = {tileX, tileY};
			entries.push({
				...tile,
				key: getRasterTileKey(tileX, tileY, tileWorldSize, rasterScale),
				bounds: getRasterTileBounds(tile, tileWorldSize),
			});
		}
	}

	return entries;
}

export function getRasterTileStrokeIdBuckets(
	entries: readonly RasterTileEntry[],
	candidates: readonly RasterTileStrokeCandidate[],
): string[][] {
	const buckets = entries.map((): string[] => []);
	const firstEntry = entries[0];

	if (!firstEntry || candidates.length === 0) {
		return buckets;
	}

	const tileWorldSize = firstEntry.bounds.maxX - firstEntry.bounds.minX;

	if (!isValidTileInput(firstEntry.bounds, tileWorldSize)) {
		return buckets;
	}

	const range = getRasterTileEntriesRange(entries);
	const columnCount = range.maxTileX - range.minTileX + 1;

	for (const candidate of candidates) {
		if (!isValidSpatialBounds(candidate.bounds)) {
			continue;
		}

		const candidateRange = getRasterTileRange(candidate.bounds, tileWorldSize);

		for (let tileY = Math.max(candidateRange.minTileY, range.minTileY); tileY <= Math.min(candidateRange.maxTileY, range.maxTileY); tileY++) {
			const rowOffset = (tileY - range.minTileY) * columnCount;

			for (let tileX = Math.max(candidateRange.minTileX, range.minTileX); tileX <= Math.min(candidateRange.maxTileX, range.maxTileX); tileX++) {
				const entryIndex = rowOffset + tileX - range.minTileX;
				const entry = entries[entryIndex];

				if (entry?.tileX === tileX
					&& entry.tileY === tileY
					&& doSpatialBoundsIntersect(candidate.bounds, entry.bounds)) {
					buckets[entryIndex]?.push(candidate.id);
				}
			}
		}
	}

	return buckets;
}

export function getRasterTileRange(bounds: StrokeSpatialBounds, tileWorldSize: number): RasterTileRange {
	return {
		minTileX: Math.floor(bounds.minX / tileWorldSize),
		maxTileX: Math.floor((bounds.maxX - Number.EPSILON) / tileWorldSize),
		minTileY: Math.floor(bounds.minY / tileWorldSize),
		maxTileY: Math.floor((bounds.maxY - Number.EPSILON) / tileWorldSize),
	};
}

export function getRasterTileEntriesRange(entries: readonly RasterTileEntry[]): RasterTileRange {
	let minTileX = Number.POSITIVE_INFINITY;
	let maxTileX = Number.NEGATIVE_INFINITY;
	let minTileY = Number.POSITIVE_INFINITY;
	let maxTileY = Number.NEGATIVE_INFINITY;

	for (const entry of entries) {
		minTileX = Math.min(minTileX, entry.tileX);
		maxTileX = Math.max(maxTileX, entry.tileX);
		minTileY = Math.min(minTileY, entry.tileY);
		maxTileY = Math.max(maxTileY, entry.tileY);
	}

	return {minTileX, maxTileX, minTileY, maxTileY};
}

export function doRasterTileBoundsIntersectAny(
	tileBounds: StrokeSpatialBounds,
	invalidationBounds: readonly StrokeSpatialBounds[],
): boolean {
	if (!isValidSpatialBounds(tileBounds)) {
		return false;
	}

	return invalidationBounds.some((bounds) =>
		isValidSpatialBounds(bounds) && doSpatialBoundsIntersect(tileBounds, bounds),
	);
}

function doSpatialBoundsIntersect(a: StrokeSpatialBounds, b: StrokeSpatialBounds): boolean {
	return a.minX <= b.maxX
		&& a.maxX >= b.minX
		&& a.minY <= b.maxY
		&& a.maxY >= b.minY;
}

function isValidSpatialBounds(bounds: StrokeSpatialBounds): boolean {
	return Number.isFinite(bounds.minX)
		&& Number.isFinite(bounds.minY)
		&& Number.isFinite(bounds.maxX)
		&& Number.isFinite(bounds.maxY)
		&& bounds.minX <= bounds.maxX
		&& bounds.minY <= bounds.maxY;
}

function isValidTileInput(bounds: StrokeSpatialBounds, tileWorldSize: number): boolean {
	return Number.isFinite(tileWorldSize)
		&& tileWorldSize > 0
		&& Number.isFinite(bounds.minX)
		&& Number.isFinite(bounds.minY)
		&& Number.isFinite(bounds.maxX)
		&& Number.isFinite(bounds.maxY)
		&& bounds.minX <= bounds.maxX
		&& bounds.minY <= bounds.maxY;
}

function roundTileNumber(value: number): number {
	return Math.round(value * 1000) / 1000;
}
