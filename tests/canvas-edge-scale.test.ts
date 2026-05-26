import assert from "node:assert/strict";
import test from "node:test";

import {getTinyCanvasEdgeVisualScale} from "../src/canvas-edge-scale.ts";

void test("tiny canvas edge visuals shrink with zoomed-out content", () => {
	assert.equal(getTinyCanvasEdgeVisualScale(6.25), 1);
});

void test("tiny canvas edge visuals stay screen-readable when zoomed in", () => {
	assert.equal(getTinyCanvasEdgeVisualScale(0.125), 0.125);
});

void test("tiny canvas edge visual scale falls back for invalid canvas scales", () => {
	assert.equal(getTinyCanvasEdgeVisualScale(0), 1);
	assert.equal(getTinyCanvasEdgeVisualScale(Number.NaN), 1);
});
