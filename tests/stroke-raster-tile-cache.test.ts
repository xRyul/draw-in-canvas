import assert from "node:assert/strict";
import test from "node:test";
import {
	doRasterTileBoundsIntersectAny,
	MAX_RASTER_TILE_CACHE_TILES,
	RASTER_TILE_SCREEN_SIZE,
	RASTER_TILE_SETUP_FRAME_BUDGET_MS,
	RASTER_TILE_SETUP_TIME_CHECK_INTERVAL,
	TILED_RASTER_CACHE_STROKE_THRESHOLD,
	getRasterTileBounds,
	getRasterTileEntries,
	getRasterTileEntriesRange,
	getRasterTileKey,
	getRasterTileStrokeIdBuckets,
	getRasterTileWorldSize,
	shouldUseTiledRasterCache,
} from "../src/stroke-raster-tile-cache.ts";

void test("uses tiled raster cache after the benchmarked dense-pan threshold", () => {
	assert.equal(shouldUseTiledRasterCache(TILED_RASTER_CACHE_STROKE_THRESHOLD, false), false);
	assert.equal(shouldUseTiledRasterCache(TILED_RASTER_CACHE_STROKE_THRESHOLD + 1, false), true);
	assert.equal(shouldUseTiledRasterCache(TILED_RASTER_CACHE_STROKE_THRESHOLD + 1, true), false);
});

void test("keeps tile bitmap dimensions bounded in screen pixels", () => {
	assert.equal(getRasterTileWorldSize(1), RASTER_TILE_SCREEN_SIZE);
	assert.equal(getRasterTileWorldSize(2), RASTER_TILE_SCREEN_SIZE / 2);
	assert.equal(getRasterTileWorldSize(0.5), RASTER_TILE_SCREEN_SIZE * 2);
	assert.equal(getRasterTileWorldSize(0), RASTER_TILE_SCREEN_SIZE);
});

void test("creates stable tile keys from tile coordinate, world size, and raster scale", () => {
	assert.equal(getRasterTileKey(2, -1, 128, 1.5), "2,-1,128,1.5");
	assert.equal(getRasterTileKey(2, -1, 42.666666, 1.333333), "2,-1,42.667,1.333");
});

void test("computes tile bounds from tile coordinates", () => {
	assert.deepEqual(getRasterTileBounds({tileX: 2, tileY: -1}, 128), {
		minX: 256,
		minY: -128,
		maxX: 384,
		maxY: 0,
	});
});

void test("enumerates intersecting tile entries in row-major order", () => {
	const entries = getRasterTileEntries({minX: 10, minY: 10, maxX: 260, maxY: 140}, 128, 1);

	assert.deepEqual(entries.map((entry) => [entry.tileX, entry.tileY]), [
		[0, 0],
		[1, 0],
		[2, 0],
		[0, 1],
		[1, 1],
		[2, 1],
	]);
	assert.equal(entries[0]?.key, "0,0,128,1");
});

void test("exposes benchmarked frame budget for chunked cold tile setup", () => {
	assert.equal(RASTER_TILE_SETUP_FRAME_BUDGET_MS > 0, true);
	assert.equal(RASTER_TILE_SETUP_FRAME_BUDGET_MS < 8, true);
	assert.equal(RASTER_TILE_SETUP_TIME_CHECK_INTERVAL, 64);
});

void test("computes the row-major range for raster tile entries", () => {
	const entries = getRasterTileEntries({minX: -129, minY: 0, maxX: 130, maxY: 260}, 128, 1);

	assert.deepEqual(getRasterTileEntriesRange(entries), {
		minTileX: -2,
		maxTileX: 1,
		minTileY: 0,
		maxTileY: 2,
	});
});

void test("assigns stroke candidates to intersecting raster tile buckets in candidate order", () => {
	const entries = getRasterTileEntries({minX: 0, minY: 0, maxX: 255, maxY: 127}, 128, 1);

	const buckets = getRasterTileStrokeIdBuckets(entries, [
		{id: "left", bounds: {minX: 10, minY: 10, maxX: 20, maxY: 20}},
		{id: "crossing", bounds: {minX: 120, minY: 10, maxX: 136, maxY: 20}},
		{id: "outside", bounds: {minX: 300, minY: 10, maxX: 320, maxY: 20}},
		{id: "right", bounds: {minX: 180, minY: 10, maxX: 190, maxY: 20}},
	]);

	assert.deepEqual(buckets, [
		["left", "crossing"],
		["crossing", "right"],
	]);
});

void test("detects only raster tiles intersecting edited stroke bounds", () => {
	const leftTile = getRasterTileBounds({tileX: 0, tileY: 0}, 128);
	const gapTile = getRasterTileBounds({tileX: 2, tileY: 0}, 128);
	const rightTile = getRasterTileBounds({tileX: 4, tileY: 0}, 128);
	const oldStrokeBounds = {minX: 8, minY: 8, maxX: 24, maxY: 24};
	const newStrokeBounds = {minX: 520, minY: 8, maxX: 536, maxY: 24};

	assert.equal(doRasterTileBoundsIntersectAny(leftTile, [oldStrokeBounds, newStrokeBounds]), true);
	assert.equal(doRasterTileBoundsIntersectAny(rightTile, [oldStrokeBounds, newStrokeBounds]), true);
	assert.equal(doRasterTileBoundsIntersectAny(gapTile, [oldStrokeBounds, newStrokeBounds]), false);
});

void test("keeps the cache size cap finite", () => {
	assert.equal(Number.isFinite(MAX_RASTER_TILE_CACHE_TILES), true);
	assert.equal(MAX_RASTER_TILE_CACHE_TILES > 0, true);
});
