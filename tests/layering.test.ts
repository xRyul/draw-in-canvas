import assert from "node:assert/strict";
import test from "node:test";

import {
	areIdOrdersEqual,
	hasLayerOrderChanged,
	getLayerActionAvailability,
	orderItemsByIds,
	reorderIdsByLayerAction,
} from "../src/layering.ts";

void test("brings selected ids forward by one layer while preserving their order", () => {
	const reorderedIds = reorderIdsByLayerAction(["a", "b", "c", "d", "e"], ["b", "c"], "bring-forward");

	assert.deepEqual(reorderedIds, ["a", "d", "b", "c", "e"]);
});

void test("sends selected ids backward by one layer while preserving their order", () => {
	const reorderedIds = reorderIdsByLayerAction(["a", "b", "c", "d", "e"], ["c", "d"], "send-backward");

	assert.deepEqual(reorderedIds, ["a", "c", "d", "b", "e"]);
});

void test("brings non-contiguous selected ids to the front", () => {
	const reorderedIds = reorderIdsByLayerAction(["a", "b", "c", "d", "e"], ["b", "d"], "bring-to-front");

	assert.deepEqual(reorderedIds, ["a", "c", "e", "b", "d"]);
});

void test("sends non-contiguous selected ids to the back", () => {
	const reorderedIds = reorderIdsByLayerAction(["a", "b", "c", "d", "e"], ["b", "d"], "send-to-back");

	assert.deepEqual(reorderedIds, ["b", "d", "a", "c", "e"]);
});

void test("reports no layer order change when selected ids are already at the target edge", () => {
	assert.equal(hasLayerOrderChanged(["a", "b", "c"], ["b", "c"], "bring-forward"), false);
	assert.equal(hasLayerOrderChanged(["a", "b", "c"], ["a", "b"], "send-backward"), false);
});

void test("computes layer action availability for a selected block once ids are known", () => {
	const availability = getLayerActionAvailability(["a", "b", "c"], new Set(["a", "b"]));

	assert.deepEqual(availability, {
		"bring-forward": true,
		"bring-to-front": true,
		"send-backward": false,
		"send-to-back": false,
	});
});

void test("compares id order by value", () => {
	assert.equal(areIdOrdersEqual(["a", "b"], ["a", "b"]), true);
	assert.equal(areIdOrdersEqual(["a", "b"], ["b", "a"]), false);
});

void test("orders items by saved id order", () => {
	const items = [{id: "a"}, {id: "b"}, {id: "c"}];

	assert.deepEqual(orderItemsByIds(items, ["c", "a", "b"]), [{id: "c"}, {id: "a"}, {id: "b"}]);
});

void test("appends unmentioned items and ignores duplicate or unknown ids", () => {
	const items = [{id: "a"}, {id: "b"}, {id: "c"}];

	assert.deepEqual(orderItemsByIds(items, ["c", "missing", "c"]), [{id: "c"}, {id: "a"}, {id: "b"}]);
});
