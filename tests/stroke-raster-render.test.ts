import assert from "node:assert/strict";
import test from "node:test";
import {
	CHUNKED_STROKE_RASTER_RENDER_THRESHOLD,
	DENSE_STROKE_RASTER_RENDER_THRESHOLD,
	RASTER_RENDER_SCREEN_PADDING,
	expandRasterRenderViewportBounds,
	getRasterDevicePixelRatio,
	getRasterRenderPadding,
	getStrokeRasterRenderPlan,
	shouldUseChunkedRasterStrokeRenderer,
	shouldUseRasterStrokeRenderer,
} from "../src/stroke-raster-render.ts";
import {STROKE_RENDER_VIEWPORT_PADDING} from "../src/stroke-render-viewport.ts";

void test("uses raster rendering after the benchmarked SVG element threshold", () => {
	assert.equal(shouldUseRasterStrokeRenderer(DENSE_STROKE_RASTER_RENDER_THRESHOLD), false);
	assert.equal(shouldUseRasterStrokeRenderer(DENSE_STROKE_RASTER_RENDER_THRESHOLD + 1), true);
});

void test("uses chunked raster drawing after the benchmarked synchronous raster limit", () => {
	assert.equal(shouldUseChunkedRasterStrokeRenderer(CHUNKED_STROKE_RASTER_RENDER_THRESHOLD), false);
	assert.equal(shouldUseChunkedRasterStrokeRenderer(CHUNKED_STROKE_RASTER_RENDER_THRESHOLD + 1), true);
});

void test("groups consecutive unselected strokes into raster runs", () => {
	assert.deepEqual(getStrokeRasterRenderPlan([
		{id: "a", isSelected: false},
		{id: "b", isSelected: false},
		{id: "c", isSelected: true},
		{id: "d", isSelected: false},
		{id: "e", isSelected: false},
	]), [
		{type: "raster", strokeIds: ["a", "b"]},
		{type: "single", strokeId: "c"},
		{type: "raster", strokeIds: ["d", "e"]},
	]);
});

void test("keeps all-selected plans as single stroke items", () => {
	assert.deepEqual(getStrokeRasterRenderPlan([
		{id: "a", isSelected: true},
		{id: "b", isSelected: true},
	]), [
		{type: "single", strokeId: "a"},
		{type: "single", strokeId: "b"},
	]);
});

void test("caps raster device pixel ratio", () => {
	assert.equal(getRasterDevicePixelRatio(0), 1);
	assert.equal(getRasterDevicePixelRatio(Number.NaN), 1);
	assert.equal(getRasterDevicePixelRatio(1.5), 1.5);
	assert.equal(getRasterDevicePixelRatio(3), 2);
});

void test("caps raster viewport padding in screen pixels at high zoom", () => {
	assert.equal(getRasterRenderPadding(0), STROKE_RENDER_VIEWPORT_PADDING);
	assert.equal(getRasterRenderPadding(1), STROKE_RENDER_VIEWPORT_PADDING);
	assert.equal(getRasterRenderPadding(2), RASTER_RENDER_SCREEN_PADDING / 2);
	assert.equal(getRasterRenderPadding(32), RASTER_RENDER_SCREEN_PADDING / 32);
});

void test("expands raster bounds using screen-capped padding", () => {
	assert.deepEqual(expandRasterRenderViewportBounds({minX: 0, minY: 10, maxX: 100, maxY: 110}, 32), {
		minX: -3,
		minY: 7,
		maxX: 103,
		maxY: 113,
	});
});
