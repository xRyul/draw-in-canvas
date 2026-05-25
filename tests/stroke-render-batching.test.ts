import assert from "node:assert/strict";
import test from "node:test";
import {
	getStrokeRenderBatchKeyForStyle,
	getStrokeRenderItems,
	type StrokeRenderBatchCandidate,
} from "../src/stroke-render-batching.ts";

function candidates(items: Array<[string, string | null, boolean?]>): StrokeRenderBatchCandidate[] {
	return items.map(([id, batchKey, isSelected = false]) => ({id, batchKey, isSelected}));
}

void test("batches consecutive compatible unselected strokes", () => {
	assert.deepEqual(getStrokeRenderItems(candidates([
		["a", "red-2"],
		["b", "red-2"],
		["c", "red-2"],
	])), [
		{type: "batch", strokeIds: ["a", "b", "c"], batchKey: "red-2"},
	]);
});

void test("preserves order by splitting batches on style changes", () => {
	assert.deepEqual(getStrokeRenderItems(candidates([
		["a", "red-2"],
		["b", "red-2"],
		["c", "blue-2"],
		["d", "red-2"],
	])), [
		{type: "batch", strokeIds: ["a", "b"], batchKey: "red-2"},
		{type: "single", strokeId: "c"},
		{type: "single", strokeId: "d"},
	]);
});

void test("selected strokes are rendered individually and split neighboring batches", () => {
	assert.deepEqual(getStrokeRenderItems(candidates([
		["a", "red-2"],
		["b", "red-2", true],
		["c", "red-2"],
		["d", "red-2"],
	])), [
		{type: "single", strokeId: "a"},
		{type: "single", strokeId: "b"},
		{type: "batch", strokeIds: ["c", "d"], batchKey: "red-2"},
	]);
});

void test("unbatchable candidates are rendered individually", () => {
	assert.deepEqual(getStrokeRenderItems(candidates([
		["a", null],
		["b", null],
	])), [
		{type: "single", strokeId: "a"},
		{type: "single", strokeId: "b"},
	]);
});

void test("creates batch keys only for visually safe opaque unfiltered styles", () => {
	assert.equal(getStrokeRenderBatchKeyForStyle({
		kind: "linear",
		color: "#ef4444",
		opacity: "1",
		blurRadius: 0,
		width: 2,
	}), "linear|#ef4444|2");

	assert.equal(getStrokeRenderBatchKeyForStyle({
		kind: "handwritten",
		color: "#ef4444",
		opacity: "1",
		blurRadius: 0,
	}), "handwritten|#ef4444");

	assert.equal(getStrokeRenderBatchKeyForStyle({
		kind: "linear",
		color: "#ef4444",
		opacity: "0.88",
		blurRadius: 0,
		width: 2,
	}), null);

	assert.equal(getStrokeRenderBatchKeyForStyle({
		kind: "linear",
		color: "#ef4444",
		opacity: "1",
		blurRadius: 0.5,
		width: 2,
	}), null);
});
