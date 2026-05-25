import test from "node:test";
import assert from "node:assert/strict";
import {
	STROKE_RENDER_VIEWPORT_PADDING,
	doStrokeBoundsIntersect,
	expandStrokeRenderViewportBounds,
	filterVisibleStrokeIds,
} from "../src/stroke-render-viewport.ts";
import type {StrokeSpatialBounds} from "../src/stroke-spatial-index.ts";

void test("expands render viewport by the benchmarked padding", () => {
	assert.deepEqual(
		expandStrokeRenderViewportBounds({minX: 10, minY: 20, maxX: 110, maxY: 220}),
		{
			minX: 10 - STROKE_RENDER_VIEWPORT_PADDING,
			minY: 20 - STROKE_RENDER_VIEWPORT_PADDING,
			maxX: 110 + STROKE_RENDER_VIEWPORT_PADDING,
			maxY: 220 + STROKE_RENDER_VIEWPORT_PADDING,
		},
	);
});

void test("filters visible stroke ids while preserving drawing order", () => {
	const boundsById = new Map<string, StrokeSpatialBounds>([
		["before", {minX: -200, minY: 0, maxX: -150, maxY: 10}],
		["touching-left-edge", {minX: -10, minY: 25, maxX: 0, maxY: 40}],
		["inside", {minX: 10, minY: 10, maxX: 20, maxY: 20}],
		["touching-bottom-edge", {minX: 50, minY: 100, maxX: 60, maxY: 110}],
		["after", {minX: 150, minY: 0, maxX: 160, maxY: 10}],
	]);

	assert.deepEqual(
		filterVisibleStrokeIds(
			["before", "touching-left-edge", "missing", "inside", "touching-bottom-edge", "after"],
			{minX: 0, minY: 0, maxX: 100, maxY: 100},
			(strokeId) => boundsById.get(strokeId) ?? null,
		),
		["touching-left-edge", "inside", "touching-bottom-edge"],
	);
});

void test("bounds intersection treats touching edges as visible", () => {
	assert.equal(
		doStrokeBoundsIntersect(
			{minX: 0, minY: 0, maxX: 100, maxY: 100},
			{minX: 100, minY: 50, maxX: 120, maxY: 60},
		),
		true,
	);

	assert.equal(
		doStrokeBoundsIntersect(
			{minX: 0, minY: 0, maxX: 100, maxY: 100},
			{minX: 101, minY: 50, maxX: 120, maxY: 60},
		),
		false,
	);
});
