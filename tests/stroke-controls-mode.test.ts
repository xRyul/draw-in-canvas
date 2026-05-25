import assert from "node:assert/strict";
import test from "node:test";

import {
	getStrokeColorButtonLabel,
	getStrokeControlsGroupLabel,
	getStrokeControlsMode,
	getStrokeOpacitySliderLabel,
	getStrokeSettingsButtonLabel,
	getStrokeSizeSliderLabel,
	shouldShowStrokeControls,
} from "../src/stroke-controls-mode.ts";

void test("shows stroke controls while drawing or while strokes are selected", () => {
	assert.equal(shouldShowStrokeControls({isDrawingEnabled: true, selectedStrokeCount: 0}), true);
	assert.equal(shouldShowStrokeControls({isDrawingEnabled: false, selectedStrokeCount: 2}), true);
	assert.equal(shouldShowStrokeControls({isDrawingEnabled: false, selectedStrokeCount: 0}), false);
});

void test("uses selection mode only when strokes are selected outside drawing mode", () => {
	assert.equal(getStrokeControlsMode({isDrawingEnabled: false, selectedStrokeCount: 1}), "selection");
	assert.equal(getStrokeControlsMode({isDrawingEnabled: true, selectedStrokeCount: 1}), "brush");
	assert.equal(getStrokeControlsMode({isDrawingEnabled: false, selectedStrokeCount: 0}), "brush");
});

void test("uses selection-specific sidebar labels", () => {
	assert.equal(getStrokeControlsGroupLabel("selection"), "Selected stroke size, color, stroke settings, and opacity");
	assert.equal(getStrokeColorButtonLabel("selection", false), "Open selected stroke color");
	assert.equal(getStrokeColorButtonLabel("selection", true), "Close selected stroke color");
	assert.equal(getStrokeSettingsButtonLabel("selection", false), "Open selected stroke and handwriting settings");
	assert.equal(getStrokeSettingsButtonLabel("selection", true), "Close selected stroke and handwriting settings");
	assert.equal(getStrokeSizeSliderLabel("selection"), "Selected stroke size");
	assert.equal(getStrokeOpacitySliderLabel("selection"), "Selected stroke opacity");
});
