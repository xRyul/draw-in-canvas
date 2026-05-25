import assert from "node:assert/strict";
import test from "node:test";

import {
	CANVAS_DOM_MUTATION_SYNC_ALL,
	CANVAS_DOM_MUTATION_SYNC_NONE,
	getCanvasDomMutationSyncFlags,
	mergeCanvasDomMutationSyncFlags,
} from "../src/canvas-dom-mutations.ts";

interface FakeElement {
	nodeType: 1;
	className: string;
	parentElement: FakeElement | null;
	childNodes: FakeElement[];
}

function fakeElement(classNames: string, childNodes: FakeElement[] = []): FakeElement {
	const element: FakeElement = {
		nodeType: 1,
		className: classNames,
		parentElement: null,
		childNodes,
	};

	for (const childNode of childNodes) {
		childNode.parentElement = element;
	}

	return element;
}

function attributeMutation(target: FakeElement, attributeName = "class", oldValue?: string): MutationRecord {
	return {
		type: "attributes",
		target,
		attributeName,
		oldValue,
		addedNodes: [],
		removedNodes: [],
	} as unknown as MutationRecord;
}

function childListMutation(target: FakeElement, addedNodes: FakeElement[] = [], removedNodes: FakeElement[] = []): MutationRecord {
	return {
		type: "childList",
		target,
		addedNodes,
		removedNodes,
	} as unknown as MutationRecord;
}

void test("plugin-owned mutations do not require native tiny/content sync", () => {
	const renderLayerEl = fakeElement("draw-in-canvas-render-layer");

	assert.deepEqual(getCanvasDomMutationSyncFlags([attributeMutation(renderLayerEl, "style")]), CANVAS_DOM_MUTATION_SYNC_NONE);
});

void test("canvas wrapper style mutations do not require native tiny/content sync", () => {
	const wrapperEl = fakeElement("canvas-wrapper draw-in-canvas-tiny-control-scale");

	assert.deepEqual(getCanvasDomMutationSyncFlags([attributeMutation(wrapperEl, "style")]), CANVAS_DOM_MUTATION_SYNC_NONE);
});

void test("canvas viewport style mutations require tiny control scaling but not native element controls", () => {
	const canvasEl = fakeElement("canvas");

	assert.deepEqual(getCanvasDomMutationSyncFlags([attributeMutation(canvasEl, "style")]), {
		syncTinyCanvasControls: true,
		syncNativeElementControls: false,
	});
});

void test("native edge mutations require tiny control scaling only", () => {
	const pathEl = fakeElement("canvas-display-path");
	const edgesEl = fakeElement("canvas-edges", [pathEl]);

	assert.deepEqual(getCanvasDomMutationSyncFlags([childListMutation(edgesEl, [pathEl])]), {
		syncTinyCanvasControls: true,
		syncNativeElementControls: false,
	});
});

void test("native menu mutations require native element controls only", () => {
	const menuButtonEl = fakeElement("clickable-icon");
	const menuEl = fakeElement("canvas-menu", [menuButtonEl]);

	assert.deepEqual(getCanvasDomMutationSyncFlags([childListMutation(menuEl, [menuButtonEl])]), {
		syncTinyCanvasControls: false,
		syncNativeElementControls: true,
	});
});

void test("plugin-owned native menu controls do not require native element controls", () => {
	const menuButtonEl = fakeElement("clickable-icon draw-in-canvas-scale-button");
	const menuEl = fakeElement("canvas-menu", [menuButtonEl]);

	assert.deepEqual(getCanvasDomMutationSyncFlags([childListMutation(menuEl, [menuButtonEl])]), CANVAS_DOM_MUTATION_SYNC_NONE);
});

void test("native canvas node content replacement requires native element controls", () => {
	const contentEl = fakeElement("canvas-node-content");
	const nodeEl = fakeElement("canvas-node", [contentEl]);

	assert.deepEqual(getCanvasDomMutationSyncFlags([childListMutation(nodeEl, [contentEl])]), {
		syncTinyCanvasControls: false,
		syncNativeElementControls: true,
	});
});

void test("scaled native node content plugin class mutations do not require native element controls", () => {
	const contentEl = fakeElement("canvas-node-content markdown-embed draw-in-canvas-scaled-node-content");

	assert.deepEqual(
		getCanvasDomMutationSyncFlags([attributeMutation(contentEl, "class", "canvas-node-content markdown-embed")]),
		CANVAS_DOM_MUTATION_SYNC_NONE,
	);
});

void test("scaled native node content style mutations do not require native element controls", () => {
	const contentEl = fakeElement("canvas-node-content draw-in-canvas-scaled-node-content");

	assert.deepEqual(getCanvasDomMutationSyncFlags([attributeMutation(contentEl, "style")]), CANVAS_DOM_MUTATION_SYNC_NONE);
});

void test("scaled native node content native class mutations require native element controls", () => {
	const contentEl = fakeElement("canvas-node-content markdown-embed is-focused draw-in-canvas-scaled-node-content");

	assert.deepEqual(
		getCanvasDomMutationSyncFlags([attributeMutation(contentEl, "class", "canvas-node-content markdown-embed draw-in-canvas-scaled-node-content")]),
		{
			syncTinyCanvasControls: false,
			syncNativeElementControls: true,
		},
	);
});

void test("markdown internals inside existing node content do not require native tiny/content sync", () => {
	const paragraphEl = fakeElement("markdown-rendered");
	fakeElement("canvas-node-content", [paragraphEl]);

	assert.deepEqual(getCanvasDomMutationSyncFlags([attributeMutation(paragraphEl, "class")]), CANVAS_DOM_MUTATION_SYNC_NONE);
});

void test("unknown canvas mutations fall back to full sync", () => {
	const unknownEl = fakeElement("future-canvas-widget");

	assert.deepEqual(getCanvasDomMutationSyncFlags([childListMutation(unknownEl)]), CANVAS_DOM_MUTATION_SYNC_ALL);
});

void test("unknown children under known canvas containers fall back to full sync", () => {
	const canvasEl = fakeElement("canvas");
	const unknownEl = fakeElement("future-canvas-widget");

	assert.deepEqual(getCanvasDomMutationSyncFlags([childListMutation(canvasEl, [unknownEl])]), CANVAS_DOM_MUTATION_SYNC_ALL);
});

void test("multiple mutation batches merge sync flags", () => {
	const merged = mergeCanvasDomMutationSyncFlags(
		getCanvasDomMutationSyncFlags([attributeMutation(fakeElement("canvas"), "style")]),
		getCanvasDomMutationSyncFlags([childListMutation(fakeElement("canvas-menu"), [fakeElement("clickable-icon")])]),
	);

	assert.deepEqual(merged, CANVAS_DOM_MUTATION_SYNC_ALL);
});
