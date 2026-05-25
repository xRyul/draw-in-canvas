import assert from "node:assert/strict";
import test from "node:test";

import {
	StrokeSpatialIndex,
	expandSpatialBounds,
	getPointSpatialQueryBounds,
	getStrokeSpatialIndexBounds,
} from "../src/stroke-spatial-index.ts";

void test("queries intersecting stroke ids in drawing order", () => {
	const index = new StrokeSpatialIndex(10);
	index.rebuild([
		{id: "bottom", bounds: {minX: 0, minY: 0, maxX: 4, maxY: 4}, order: 0},
		{id: "middle", bounds: {minX: 20, minY: 20, maxX: 24, maxY: 24}, order: 1},
		{id: "top", bounds: {minX: 2, minY: 2, maxX: 8, maxY: 8}, order: 2},
	]);

	assert.deepEqual(index.queryBounds({minX: 1, minY: 1, maxX: 5, maxY: 5}), ["bottom", "top"]);
	assert.deepEqual(index.queryBounds({minX: 1, minY: 1, maxX: 5, maxY: 5}, "descending"), ["top", "bottom"]);
});

void test("updates moved stroke bounds and removes stale cells", () => {
	const index = new StrokeSpatialIndex(10);
	index.set("stroke", {minX: 0, minY: 0, maxX: 4, maxY: 4}, 0);

	index.updateBounds("stroke", {minX: 30, minY: 30, maxX: 34, maxY: 34});

	assert.deepEqual(index.queryBounds({minX: 0, minY: 0, maxX: 5, maxY: 5}), []);
	assert.deepEqual(index.queryBounds({minX: 29, minY: 29, maxX: 35, maxY: 35}), ["stroke"]);
});

void test("keeps order updates separate from bounds", () => {
	const index = new StrokeSpatialIndex(10);
	index.rebuild([
		{id: "a", bounds: {minX: 0, minY: 0, maxX: 4, maxY: 4}, order: 0},
		{id: "b", bounds: {minX: 0, minY: 0, maxX: 4, maxY: 4}, order: 1},
	]);

	index.setOrder(["b", "a"]);

	assert.deepEqual(index.queryBounds({minX: 0, minY: 0, maxX: 4, maxY: 4}), ["b", "a"]);
});

void test("expands stroke bounds by half stroke width for safe hit-test candidates", () => {
	const indexedBounds = getStrokeSpatialIndexBounds({minX: 10, minY: 10, maxX: 20, maxY: 20}, 8);

	assert.deepEqual(indexedBounds, {minX: 6, minY: 6, maxX: 24, maxY: 24});
	assert.deepEqual(getPointSpatialQueryBounds({x: 0, y: 0}, 3), {minX: -3, minY: -3, maxX: 3, maxY: 3});
	assert.deepEqual(expandSpatialBounds({minX: 1, minY: 2, maxX: 3, maxY: 4}, 2), {minX: -1, minY: 0, maxX: 5, maxY: 6});
});
