import assert from "node:assert/strict";
import test from "node:test";

import {
	createStrokeHandwriting,
	normalizeStrokeHandwriting,
} from "../src/stroke-handwriting.ts";
import type {DrawInCanvasSettings} from "../src/settings.ts";

const SETTINGS: DrawInCanvasSettings = {
	strokeColor: "#3b82f6",
	strokeWidth: 3,
	strokeHardness: 100,
	strokeOpacity: 100,
	beautifulStrokes: true,
	strokeThinning: -0.42,
	strokeStreamline: 0.25,
	strokeSmoothing: 0.75,
	strokeTaperStart: 6,
	strokeTaperEnd: 14,
	usePenCursorFallback: false,
	allowTinyCanvasElements: false,
};

void test("captures current handwriting settings for a new stroke", () => {
	assert.deepEqual(createStrokeHandwriting(SETTINGS), {
		enabled: true,
		thinning: -0.42,
		streamline: 0.25,
		smoothing: 0.75,
		taperStart: 6,
		taperEnd: 14,
	});
});

void test("backfills legacy stroke handwriting from the active settings", () => {
	assert.deepEqual(normalizeStrokeHandwriting(undefined, SETTINGS), {
		enabled: true,
		thinning: -0.42,
		streamline: 0.25,
		smoothing: 0.75,
		taperStart: 6,
		taperEnd: 14,
	});
});

void test("keeps stored stroke handwriting independent of fallback settings", () => {
	assert.deepEqual(normalizeStrokeHandwriting({
		enabled: false,
		thinning: 0.1,
		streamline: 0.2,
		smoothing: 0.3,
		taperStart: 4,
		taperEnd: 5,
	}, SETTINGS), {
		enabled: false,
		thinning: 0.1,
		streamline: 0.2,
		smoothing: 0.3,
		taperStart: 4,
		taperEnd: 5,
	});
});
