import assert from "node:assert/strict";
import test from "node:test";
import {
	createStrokePathCacheKey,
	MAX_CACHED_STROKE_PATH_DATA,
	MAX_CACHED_STROKE_RASTER_PATHS,
	StrokePathCache,
} from "../src/stroke-path-cache.ts";
import type {DrawInCanvasSettings} from "../src/settings.ts";
import type {CanvasStroke} from "../src/types.ts";

const SETTINGS: DrawInCanvasSettings = {
	strokeColor: "#3b82f6",
	strokeWidth: 3,
	strokeHardness: 100,
	strokeOpacity: 100,
	beautifulStrokes: false,
	strokeThinning: 0.5,
	strokeSmoothing: 0.5,
	strokeStreamline: 0.5,
	strokeTaperStart: 0,
	strokeTaperEnd: 0,
	usePenCursorFallback: false,
	allowTinyCanvasElements: false,
};

const HANDWRITING = {
	enabled: true,
	thinning: 0.2,
	smoothing: 0.3,
	streamline: 0.4,
	taperStart: 6,
	taperEnd: 12,
};

function stroke(overrides: Partial<CanvasStroke> = {}): CanvasStroke {
	return {
		id: "stroke-a",
		color: "#3b82f6",
		width: 3,
		hardness: 100,
		opacity: 100,
		points: [
			{x: 0, y: 0},
			{x: 10, y: 5, pressure: 0.4},
		],
		createdAt: 1,
		handwriting: HANDWRITING,
		...overrides,
	};
}

void test("caches path data by key and reuses warm redraw values", () => {
	const cache = new StrokePathCache();
	let createCount = 0;

	assert.equal(cache.getPathData("stroke-a", "stroke-a|linear", () => {
		createCount++;
		return "M 0 0 L 1 1";
	}), "M 0 0 L 1 1");

	assert.equal(cache.getPathData("stroke-a", "stroke-a|linear", () => {
		createCount++;
		return "unexpected";
	}), "M 0 0 L 1 1");
	assert.equal(createCount, 1);
});

void test("caches raster paths by key and skips warm redraw creation", () => {
	const cache = new StrokePathCache();
	let createCount = 0;

	const firstPath = cache.getRasterPath("stroke-a", "stroke-a|raster", () => {
		createCount++;
		return {id: "raster-a"};
	});
	const secondPath = cache.getRasterPath("stroke-a", "stroke-a|raster", () => {
		createCount++;
		return {id: "unexpected"};
	});

	assert.equal(createCount, 1);
	assert.equal(secondPath, firstPath);
});

void test("invalidates all cached path data and raster paths for one stroke", () => {
	const cache = new StrokePathCache();
	cache.getPathData("stroke-a", "stroke-a|path", () => "path-a");
	cache.getRasterPath("stroke-a", "stroke-a|raster", () => ({id: "raster-a"}));
	cache.invalidateStroke("stroke-a");

	assert.equal(cache.getPathDataEntryCount(), 0);
	assert.equal(cache.getRasterPathEntryCount(), 0);
	assert.equal(cache.getPathData("stroke-a", "stroke-a|path", () => "path-b"), "path-b");
});

void test("evicts oldest path data and raster paths independently without hit-time map churn", () => {
	const cache = new StrokePathCache(2, 2);
	cache.getPathData("a", "a|1", () => "a1");
	cache.getPathData("b", "b|1", () => "b1");
	cache.getPathData("a", "a|1", () => "unused");
	cache.getPathData("c", "c|1", () => "c1");

	assert.equal(cache.getPathDataEntryCount(), 2);
	assert.equal(cache.getPathData("a", "a|1", () => "a2"), "a2");

	cache.getRasterPath("a", "a|r1", () => ({id: "a1"}));
	cache.getRasterPath("b", "b|r1", () => ({id: "b1"}));
	cache.getRasterPath("a", "a|r1", () => ({id: "unused"}));
	cache.getRasterPath("c", "c|r1", () => ({id: "c1"}));

	assert.equal(cache.getRasterPathEntryCount(), 2);
	assert.deepEqual(cache.getRasterPath("a", "a|r1", () => ({id: "a2"})), {id: "a2"});
});

void test("path cache key keeps handwritten stroke style independent of current settings", () => {
	const baseStroke = stroke();
	const baseKey = createStrokePathCacheKey(baseStroke, {
		kind: "handwritten",
		settings: SETTINGS,
		isComplete: true,
		hasPressure: true,
		isStart: true,
		isEnd: true,
	});
	const movedKey = createStrokePathCacheKey(stroke({points: [{x: 1, y: 0}, {x: 10, y: 5, pressure: 0.4}]}), {
		kind: "handwritten",
		settings: SETTINGS,
		isComplete: true,
		hasPressure: true,
		isStart: true,
		isEnd: true,
	});
	const currentSettingKey = createStrokePathCacheKey(baseStroke, {
		kind: "handwritten",
		settings: {...SETTINGS, strokeSmoothing: 0.9, strokeThinning: -0.5, strokeTaperStart: 24},
		isComplete: true,
		hasPressure: true,
		isStart: true,
		isEnd: true,
	});
	const strokeSettingKey = createStrokePathCacheKey(stroke({
		handwriting: {...HANDWRITING, smoothing: 0.9},
	}), {
		kind: "handwritten",
		settings: SETTINGS,
		isComplete: true,
		hasPressure: true,
		isStart: true,
		isEnd: true,
	});

	assert.notEqual(baseKey, movedKey);
	assert.equal(baseKey, currentSettingKey);
	assert.notEqual(baseKey, strokeSettingKey);
});

void test("documents benchmarked cache size caps", () => {
	assert.equal(MAX_CACHED_STROKE_PATH_DATA, 20_000);
	assert.equal(MAX_CACHED_STROKE_RASTER_PATHS, 8_192);
});
