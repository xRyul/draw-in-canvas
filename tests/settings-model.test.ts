import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_SETTINGS,
	normalizeDrawInCanvasSettings,
} from "../src/settings-model.ts";

void test("uses defaults when no plugin settings data exists", () => {
	assert.deepEqual(normalizeDrawInCanvasSettings(null), DEFAULT_SETTINGS);
});

void test("uses defaults when plugin settings data is undefined", () => {
	assert.deepEqual(normalizeDrawInCanvasSettings(undefined), DEFAULT_SETTINGS);
});
