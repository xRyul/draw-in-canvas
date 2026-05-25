import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_MAX_NATIVE_CANVAS_ZOOM,
	DEFAULT_MIN_NATIVE_CANVAS_ZOOM,
	EXTENDED_MAX_NATIVE_CANVAS_SCALE,
	EXTENDED_MAX_NATIVE_CANVAS_ZOOM,
	clampNativeCanvasScaleForTinyElements,
	clampNativeCanvasZoomForTinyElements,
} from "../src/canvas-zoom-limits.ts";

void test("extended tiny-canvas zoom keeps native zoom-out limit and caps zoom-in at the benchmarked limit", () => {
	assert.equal(clampNativeCanvasZoomForTinyElements(DEFAULT_MIN_NATIVE_CANVAS_ZOOM - 1), DEFAULT_MIN_NATIVE_CANVAS_ZOOM);
	assert.equal(clampNativeCanvasZoomForTinyElements(DEFAULT_MAX_NATIVE_CANVAS_ZOOM), DEFAULT_MAX_NATIVE_CANVAS_ZOOM);
	assert.equal(clampNativeCanvasZoomForTinyElements(EXTENDED_MAX_NATIVE_CANVAS_ZOOM - 1), EXTENDED_MAX_NATIVE_CANVAS_ZOOM - 1);
	assert.equal(clampNativeCanvasZoomForTinyElements(EXTENDED_MAX_NATIVE_CANVAS_ZOOM + 1), EXTENDED_MAX_NATIVE_CANVAS_ZOOM);
	assert.equal(clampNativeCanvasZoomForTinyElements(Number.POSITIVE_INFINITY), EXTENDED_MAX_NATIVE_CANVAS_ZOOM);
});

void test("extended tiny-canvas scale maps to the same benchmarked zoom cap", () => {
	const nativeMinScale = 2 ** DEFAULT_MIN_NATIVE_CANVAS_ZOOM;
	const nativeScale = 2 ** DEFAULT_MAX_NATIVE_CANVAS_ZOOM;
	const overLimitScale = 2 ** (EXTENDED_MAX_NATIVE_CANVAS_ZOOM + 1);

	assert.equal(clampNativeCanvasScaleForTinyElements(nativeMinScale / 2), nativeMinScale);
	assert.equal(clampNativeCanvasScaleForTinyElements(nativeScale), nativeScale);
	assert.equal(clampNativeCanvasScaleForTinyElements(EXTENDED_MAX_NATIVE_CANVAS_SCALE / 2), EXTENDED_MAX_NATIVE_CANVAS_SCALE / 2);
	assert.equal(clampNativeCanvasScaleForTinyElements(overLimitScale), EXTENDED_MAX_NATIVE_CANVAS_SCALE);
	assert.equal(clampNativeCanvasScaleForTinyElements(Number.POSITIVE_INFINITY), EXTENDED_MAX_NATIVE_CANVAS_SCALE);
});
