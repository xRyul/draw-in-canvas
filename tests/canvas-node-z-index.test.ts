import assert from "node:assert/strict";
import test from "node:test";

import {
	acquireStableCanvasNodeZIndexPatch,
	getStableCanvasNodeZIndexPatchPrototypes,
	renderCanvasNodeZIndexes,
	type StableCanvasNodeZIndexPatchCanvas,
	type StableCanvasNodeZIndexPatchNode,
} from "../src/canvas-node-z-index.ts";

interface FakeNode extends StableCanvasNodeZIndexPatchNode {
	canvas: {
		selection: Set<FakeNode>;
		zIndexCounter: number;
	};
	nodeEl: {style: {zIndex: string}};
	zIndex: number | undefined;
	width: number;
	height: number;
}

void test("patch keeps a single selected canvas node at its saved layer z-index", () => {
	const prototype = {renderZIndex: selectionBoostedRenderZIndex};
	const node = createNode(prototype, 2);
	node.canvas.selection.add(node);
	node.canvas.zIndexCounter = 99;

	const release = acquireStableCanvasNodeZIndexPatch(prototype);
	try {
		node.renderZIndex?.();

		assert.equal(node.nodeEl.style.zIndex, "2");
		assert.equal(node.renderedZIndex, 2);
	} finally {
		release();
	}
});

void test("patch uses a stable base layer when a selected canvas node has no saved z-index", () => {
	const prototype = {renderZIndex: selectionBoostedRenderZIndex};
	const node = createNode(prototype, undefined);
	node.canvas.selection.add(node);
	node.canvas.zIndexCounter = 99;

	const release = acquireStableCanvasNodeZIndexPatch(prototype);
	try {
		node.renderZIndex?.();

		assert.equal(node.nodeEl.style.zIndex, "0");
		assert.equal(node.renderedZIndex, 0);
	} finally {
		release();
	}
});

void test("patch release restores Obsidian's original selected-node z-index renderer", () => {
	const prototype = {renderZIndex: selectionBoostedRenderZIndex};
	const node = createNode(prototype, 2);
	node.canvas.selection.add(node);
	node.canvas.zIndexCounter = 99;

	const release = acquireStableCanvasNodeZIndexPatch(prototype);
	release();
	node.renderZIndex?.();

	assert.equal(node.nodeEl.style.zIndex, "100");
	assert.equal(node.renderedZIndex, 100);
});

void test("patch discovery ignores renderers that do not contain the selected-node boost", () => {
	const boostedPrototype = {renderZIndex: selectionBoostedRenderZIndex};
	const groupPrototype = {renderZIndex: groupRenderZIndex};
	const boostedNode = createNode(boostedPrototype, 3);
	const groupNode = createNode(groupPrototype, -400);
	const canvas: StableCanvasNodeZIndexPatchCanvas = {
		nodes: new Map([
			["boosted", boostedNode],
			["group", groupNode],
		]),
	};

	assert.deepEqual(getStableCanvasNodeZIndexPatchPrototypes(canvas), [boostedPrototype]);
});

void test("patch discovery keeps already-patched prototypes during later syncs", () => {
	const prototype = {renderZIndex: selectionBoostedRenderZIndex};
	const node = createNode(prototype, 6);
	const canvas: StableCanvasNodeZIndexPatchCanvas = {
		nodes: new Map([["node", node]]),
	};

	const release = acquireStableCanvasNodeZIndexPatch(prototype);
	try {
		assert.deepEqual(getStableCanvasNodeZIndexPatchPrototypes(canvas), [prototype]);
	} finally {
		release();
	}
});

void test("patch acquisition is reference counted across repeated acquirers", () => {
	const prototype = {renderZIndex: selectionBoostedRenderZIndex};
	const originalRenderZIndex = prototype.renderZIndex;

	const releaseFirst = acquireStableCanvasNodeZIndexPatch(prototype);
	const patchedRenderZIndex = prototype.renderZIndex;
	const releaseSecond = acquireStableCanvasNodeZIndexPatch(prototype);

	try {
		releaseFirst();
		assert.equal(prototype.renderZIndex, patchedRenderZIndex);

		releaseSecond();
		assert.equal(prototype.renderZIndex, originalRenderZIndex);
	} finally {
		releaseSecond();
		releaseFirst();
	}
});

void test("render sync normalizes selected node z-indexes after acquiring the patch", () => {
	const prototype = {renderZIndex: selectionBoostedRenderZIndex};
	const selectedNode = createNode(prototype, 4);
	const topNode = createNode(prototype, 5);
	selectedNode.canvas.selection.add(selectedNode);
	const canvas: StableCanvasNodeZIndexPatchCanvas = {
		nodes: new Map([
			["selected", selectedNode],
			["top", topNode],
		]),
	};

	const release = acquireStableCanvasNodeZIndexPatch(prototype);
	try {
		renderCanvasNodeZIndexes(canvas);

		assert.equal(selectedNode.nodeEl.style.zIndex, "4");
		assert.equal(topNode.nodeEl.style.zIndex, "5");
	} finally {
		release();
	}
});

function createNode(prototype: {renderZIndex: (this: FakeNode) => void}, zIndex: number | undefined): FakeNode {
	const node = Object.create(prototype) as FakeNode;
	node.canvas = {
		selection: new Set<FakeNode>(),
		zIndexCounter: 0,
	};
	node.nodeEl = {style: {zIndex: ""}};
	node.zIndex = zIndex;
	node.width = 20;
	node.height = 20;
	return node;
}

function selectionBoostedRenderZIndex(this: FakeNode): void {
	const canvas = this.canvas;
	let zIndex = this.zIndex;

	if (canvas.selection.size === 1 && canvas.selection.has(this)) {
		zIndex = canvas.zIndexCounter + 1;
	}

	if (zIndex !== this.renderedZIndex) {
		this.nodeEl.style.zIndex = zIndex?.toString() ?? "";
		this.renderedZIndex = zIndex;
	}
}

function groupRenderZIndex(this: FakeNode): void {
	const zIndex = Math.round(-this.width * this.height);
	this.zIndex = zIndex;
	this.nodeEl.style.zIndex = zIndex.toString();
}
