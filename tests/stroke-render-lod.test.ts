import assert from "node:assert/strict";
import test from "node:test";
import {
	MIN_RENDERED_STROKE_SCREEN_SIZE,
	getStrokeScreenMaxDimension,
	shouldRenderStrokeAtLevelOfDetail,
} from "../src/stroke-render-lod.ts";

void test("measures stroke bounds in screen pixels", () => {
	assert.equal(
		getStrokeScreenMaxDimension({minX: 0, minY: 0, maxX: 8, maxY: 3}, 0.25),
		2,
	);
});

void test("skips unselected strokes smaller than the benchmarked low-zoom LOD limit", () => {
	assert.equal(
		shouldRenderStrokeAtLevelOfDetail(
			{minX: 0, minY: 0, maxX: 7, maxY: 7},
			0.0625,
		),
		false,
	);

	assert.equal(
		shouldRenderStrokeAtLevelOfDetail(
			{minX: 0, minY: 0, maxX: 8, maxY: 7},
			0.0625,
		),
		true,
	);
});

void test("keeps selected strokes renderable even when below the low-zoom LOD limit", () => {
	assert.equal(
		shouldRenderStrokeAtLevelOfDetail(
			{minX: 0, minY: 0, maxX: 2, maxY: 2},
			0.0625,
			true,
		),
		true,
	);
});

void test("renders by default when screen scale is invalid", () => {
	assert.equal(
		shouldRenderStrokeAtLevelOfDetail(
			{minX: 0, minY: 0, maxX: 0.1, maxY: 0.1},
			Number.NaN,
		),
		true,
	);

	assert.equal(MIN_RENDERED_STROKE_SCREEN_SIZE, 0.5);
});
