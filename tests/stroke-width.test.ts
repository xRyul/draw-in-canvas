import assert from "node:assert/strict";
import test from "node:test";
import {
	getCanvasDistanceForScreenPixels,
	getCanvasStrokeHandwritingForScreenPixels,
	getCanvasStrokeWidthForScreenPixels,
} from "../src/stroke-width.ts";

void test("converts selected screen-pixel brush width into canvas units for the current zoom", () => {
	assert.equal(getCanvasStrokeWidthForScreenPixels(8, 1), 8);
	assert.equal(getCanvasStrokeWidthForScreenPixels(8, 2), 4);
	assert.equal(getCanvasStrokeWidthForScreenPixels(8, 10), 0.8);
});

void test("falls back to unscaled width when the screen scale is invalid", () => {
	assert.equal(getCanvasStrokeWidthForScreenPixels(8, 0), 8);
	assert.equal(getCanvasStrokeWidthForScreenPixels(8, Number.NaN), 8);
});

void test("converts minimum point spacing into canvas units for the current zoom", () => {
	assert.equal(getCanvasDistanceForScreenPixels(1, 1), 1);
	assert.equal(getCanvasDistanceForScreenPixels(1, 10), 0.1);
	assert.equal(getCanvasDistanceForScreenPixels(1, 100), 0.01);
});

void test("converts handwriting taper distances into canvas units for the current zoom", () => {
	const handwriting = {
		enabled: true,
		thinning: 0.5,
		streamline: 0.5,
		smoothing: 0.5,
		taperStart: 8,
		taperEnd: 12,
	};

	assert.deepEqual(getCanvasStrokeHandwritingForScreenPixels(handwriting, 10), {
		...handwriting,
		taperStart: 0.8,
		taperEnd: 1.2,
	});
});
