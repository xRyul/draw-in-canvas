import assert from "node:assert/strict";
import test from "node:test";

import {getNativeCanvasGridSpacingForTinyElements, getNativeCanvasSnapDistanceForTinyElements} from "../src/canvas-snapping.ts";
import {NativeCanvasInteractionLimits} from "../src/canvas-limits.ts";

import {
	DEFAULT_MAX_NATIVE_CANVAS_ZOOM,
	DEFAULT_MIN_NATIVE_CANVAS_ZOOM,
	EXTENDED_MAX_NATIVE_CANVAS_SCALE,
	EXTENDED_MAX_NATIVE_CANVAS_ZOOM,
	clampNativeCanvasScaleForTinyElements,
	clampNativeCanvasZoomForTinyElements,
} from "../src/canvas-zoom-limits.ts";

class FakeCanvasWithPrototypeSnapping {
	config = {minContainerDimension: 50, objectSnapDistance: 10};
	zoom = DEFAULT_MAX_NATIVE_CANVAS_ZOOM + 1;
	scale = 2 ** this.zoom;

	get gridSpacing(): number {
		return 20;
	}

	get snapDistance(): number {
		return Math.ceil(this.config.objectSnapDistance / this.scale);
	}
}

function createInteractionLimitsTarget(canvas: unknown): ConstructorParameters<typeof NativeCanvasInteractionLimits>[0] {
	return {view: {canvas}} as unknown as ConstructorParameters<typeof NativeCanvasInteractionLimits>[0];
}

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

void test("tiny-canvas grid spacing preserves native spacing through Obsidian's default zoom range", () => {
	assert.equal(getNativeCanvasGridSpacingForTinyElements(-4), 160);
	assert.equal(getNativeCanvasGridSpacingForTinyElements(-3), 80);
	assert.equal(getNativeCanvasGridSpacingForTinyElements(-2), 40);
	assert.equal(getNativeCanvasGridSpacingForTinyElements(0), 20);
	assert.equal(getNativeCanvasGridSpacingForTinyElements(DEFAULT_MAX_NATIVE_CANVAS_ZOOM), 20);
	assert.equal(getNativeCanvasGridSpacingForTinyElements(Number.NaN), 20);
});

void test("tiny-canvas grid spacing gets more precise beyond Obsidian's default zoom limit", () => {
	const defaultMaxZoomScreenSpacing = 20 * (2 ** DEFAULT_MAX_NATIVE_CANVAS_ZOOM);
	const extendedZoomSpacing = getNativeCanvasGridSpacingForTinyElements(EXTENDED_MAX_NATIVE_CANVAS_ZOOM);

	assert.equal(getNativeCanvasGridSpacingForTinyElements(2), 10);
	assert.equal(extendedZoomSpacing, 20 / (2 ** (EXTENDED_MAX_NATIVE_CANVAS_ZOOM - DEFAULT_MAX_NATIVE_CANVAS_ZOOM)));
	assert.equal(extendedZoomSpacing * (2 ** EXTENDED_MAX_NATIVE_CANVAS_ZOOM), defaultMaxZoomScreenSpacing);
});

void test("tiny-canvas snap distance preserves native snapping through Obsidian's default zoom range", () => {
	assert.equal(getNativeCanvasSnapDistanceForTinyElements(10, 1), 10);
	assert.equal(getNativeCanvasSnapDistanceForTinyElements(10, 2 ** DEFAULT_MAX_NATIVE_CANVAS_ZOOM), 5);
	assert.equal(getNativeCanvasSnapDistanceForTinyElements(undefined, 1), 0);
	assert.equal(getNativeCanvasSnapDistanceForTinyElements(10, Number.NaN), 10);
});

void test("tiny-canvas snap distance gets more precise beyond Obsidian's default zoom limit", () => {
	const extendedScale = 2 ** EXTENDED_MAX_NATIVE_CANVAS_ZOOM;
	const extendedSnapDistance = getNativeCanvasSnapDistanceForTinyElements(10, extendedScale);

	assert.equal(getNativeCanvasSnapDistanceForTinyElements(10, 4), 2.5);
	assert.equal(extendedSnapDistance, 10 / extendedScale);
	assert.equal(extendedSnapDistance * extendedScale, 10);
});

void test("native canvas interaction limits make grid and object snapping zoom-precise while enabled", () => {
	const canvas = new FakeCanvasWithPrototypeSnapping();
	const limits = new NativeCanvasInteractionLimits(createInteractionLimitsTarget(canvas));

	limits.setEnabled(true);

	assert.equal(canvas.config.minContainerDimension, 1);
	assert.equal(canvas.gridSpacing, 10);
	assert.equal(canvas.snapDistance, 2.5);

	canvas.zoom = EXTENDED_MAX_NATIVE_CANVAS_ZOOM;
	canvas.scale = 2 ** canvas.zoom;
	assert.equal(canvas.gridSpacing, getNativeCanvasGridSpacingForTinyElements(EXTENDED_MAX_NATIVE_CANVAS_ZOOM));
	assert.equal(canvas.snapDistance, getNativeCanvasSnapDistanceForTinyElements(canvas.config.objectSnapDistance, canvas.scale));

	limits.dispose();

	assert.equal(canvas.config.minContainerDimension, 50);
	assert.equal(canvas.gridSpacing, 20);
	assert.equal(canvas.snapDistance, Math.ceil(canvas.config.objectSnapDistance / canvas.scale));
	assert.equal(Object.prototype.hasOwnProperty.call(canvas, "snapDistance"), false);
	assert.equal(Object.prototype.hasOwnProperty.call(canvas, "gridSpacing"), false);
});
