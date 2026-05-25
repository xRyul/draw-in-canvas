import assert from "node:assert/strict";
import test from "node:test";

import {
	getSelectedCanvasNodeResizePrototypes,
	type CanvasResizePrototypeCanvas,
	type CanvasResizePrototypeNode,
} from "../src/canvas-resize-prototypes.ts";

class SelectedResizableNode {
	onResizePointerdown(): void {}
}

class UnselectedResizableNode {
	onResizePointerdown(): void {}
}

class SelectedNonResizableNode {
	onResizePointerdown(): void {}
}

class BaseResizableNode {
	onResizePointerdown(): void {}
}

class ChildResizableNode extends BaseResizableNode {}

function createNode(id: string, prototype: object, resizable = true): CanvasResizePrototypeNode {
	const node = {
		id,
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		...(resizable ? {moveAndResize(): void {}} : {}),
	};

	Object.setPrototypeOf(node, prototype);
	return node;
}

function createCanvas(nodes: CanvasResizePrototypeNode[], selection: Iterable<unknown>): CanvasResizePrototypeCanvas {
	return {
		nodes: new Map(nodes.map((node) => [node.id ?? "", node])),
		selection: new Set(selection),
	};
}

void test("resize prototype discovery scans selected resizable canvas nodes only", () => {
	const selectedNode = createNode("selected", SelectedResizableNode.prototype);
	const unselectedNode = createNode("unselected", UnselectedResizableNode.prototype);
	const nonResizableNode = createNode("non-resizable", SelectedNonResizableNode.prototype, false);
	const canvas = createCanvas([selectedNode, unselectedNode, nonResizableNode], ["selected", "non-resizable"]);

	const resizePrototypes = getSelectedCanvasNodeResizePrototypes(canvas);

	assert.deepEqual(resizePrototypes, [SelectedResizableNode.prototype]);
});

void test("resize prototype discovery accepts selected canvas node objects", () => {
	const selectedNode = createNode("selected", SelectedResizableNode.prototype);
	const canvas = createCanvas([selectedNode], [{id: "selected"}]);

	const resizePrototypes = getSelectedCanvasNodeResizePrototypes(canvas);

	assert.deepEqual(resizePrototypes, [SelectedResizableNode.prototype]);
});

void test("resize prototype discovery deduplicates inherited resize handlers", () => {
	const firstNode = createNode("first", ChildResizableNode.prototype);
	const secondNode = createNode("second", ChildResizableNode.prototype);
	const canvas = createCanvas([firstNode, secondNode], ["first", "second"]);

	const resizePrototypes = getSelectedCanvasNodeResizePrototypes(canvas);

	assert.deepEqual(resizePrototypes, [BaseResizableNode.prototype]);
});
