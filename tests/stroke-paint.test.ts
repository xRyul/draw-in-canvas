import assert from "node:assert/strict";
import test from "node:test";

import {updateVisibleStrokePaintAttributes, type VisibleStrokePaintPath} from "../src/stroke-paint.ts";

function createPath(tokens: readonly string[] = []): {path: VisibleStrokePaintPath; attributes: Record<string, string>} {
	const attributes: Record<string, string> = {};

	return {
		attributes,
		path: {
			classList: {
				contains: (token: string) => tokens.includes(token),
			},
			setAttribute: (name: string, value: string) => {
				attributes[name] = value;
			},
		},
	};
}

void test("updates fill for handwritten stroke paths", () => {
	const {path, attributes} = createPath(["mod-handwritten"]);

	updateVisibleStrokePaintAttributes(path, "#123456");

	assert.deepEqual(attributes, {fill: "#123456"});
});

void test("updates stroke for centerline stroke paths", () => {
	const {path, attributes} = createPath();

	updateVisibleStrokePaintAttributes(path, "#abcdef");

	assert.deepEqual(attributes, {stroke: "#abcdef"});
});
