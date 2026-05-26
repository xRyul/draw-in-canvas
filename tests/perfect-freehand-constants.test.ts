import assert from "node:assert/strict";
import test from "node:test";

import {
	END_NOISE_THRESHOLD,
	MIN_RADIUS,
	getEndNoiseThreshold,
	getMinimumStrokeRadius,
} from "../src/perfect-freehand/constants.ts";

void test("caps end-noise threshold by stroke size for high-zoom sub-canvas-unit handwriting", () => {
	assert.equal(getEndNoiseThreshold(8), END_NOISE_THRESHOLD);
	assert.equal(getEndNoiseThreshold(0.08), 0.08);
});

void test("caps minimum radius by stroke size for high-zoom sub-canvas-unit handwriting", () => {
	assert.equal(getMinimumStrokeRadius(8), MIN_RADIUS);
	assert.equal(getMinimumStrokeRadius(0.001953125), 0.00001953125);
});
