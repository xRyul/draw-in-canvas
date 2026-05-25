import assert from "node:assert/strict";
import test from "node:test";

import {
	areStrokeStylesEqual,
	cloneStrokeStyle,
	getStrokeStyle,
	setStrokeStyle,
	type CanvasStrokeStyle,
} from "../src/stroke-style.ts";
import type {CanvasStroke} from "../src/types.ts";

const STYLE: CanvasStrokeStyle = {
	width: 4,
	hardness: 80,
	opacity: 90,
	handwriting: {
		enabled: true,
		thinning: 0.4,
		streamline: 0.5,
		smoothing: 0.6,
		taperStart: 8,
		taperEnd: 10,
	},
};

function createStroke(style: CanvasStrokeStyle = STYLE): CanvasStroke {
	return {
		id: "stroke-a",
		color: "#ff0000",
		width: style.width,
		hardness: style.hardness,
		opacity: style.opacity,
		handwriting: {...style.handwriting},
		points: [{x: 0, y: 0}, {x: 10, y: 10}],
		createdAt: 1,
	};
}

void test("captures stroke style without sharing nested handwriting", () => {
	const stroke = createStroke();
	const style = getStrokeStyle(stroke);

	style.handwriting.thinning = 0.9;

	assert.equal(stroke.handwriting.thinning, STYLE.handwriting.thinning);
});

void test("clones stroke style without sharing nested handwriting", () => {
	const style = cloneStrokeStyle(STYLE);

	style.handwriting.enabled = false;

	assert.equal(STYLE.handwriting.enabled, true);
});

void test("detects handwriting style differences", () => {
	assert.equal(areStrokeStylesEqual(STYLE, {...STYLE, handwriting: {...STYLE.handwriting}}), true);
	assert.equal(areStrokeStylesEqual(STYLE, {...STYLE, handwriting: {...STYLE.handwriting, taperEnd: 11}}), false);
});

void test("sets stroke style and reports whether anything changed", () => {
	const stroke = createStroke();

	assert.equal(setStrokeStyle(stroke, STYLE), false);
	assert.equal(setStrokeStyle(stroke, {...STYLE, width: 12, handwriting: {...STYLE.handwriting, enabled: false}}), true);
	assert.equal(stroke.width, 12);
	assert.equal(stroke.handwriting.enabled, false);
	assert.equal(stroke.handwriting.thinning, STYLE.handwriting.thinning);
});
