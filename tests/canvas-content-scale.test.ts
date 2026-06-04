import assert from "node:assert/strict";
import test from "node:test";

import {
	CONTENT_SCALE_CLASS,
	NativeCanvasContentScaleSync,
	getNextNodeContentScale,
	type CanvasContentScaleCanvas,
	type CanvasContentScaleNode,
	type CanvasContentScaleNodeData,
} from "../src/canvas-content-scale.ts";

class FakeClassList {
	private readonly classes = new Set<string>();

	add(className: string): void {
		this.classes.add(className);
	}

	remove(className: string): void {
		this.classes.delete(className);
	}

	contains(className: string): boolean {
		return this.classes.has(className);
	}
}

interface FakeContentEl {
	classList: FakeClassList;
	styles: Record<string, string>;
	setCssStyles(styles: Record<string, string>): void;
}

interface FakeNode extends CanvasContentScaleNode {
	data: CanvasContentScaleNodeData;
	getDataCalls: number;
	contentEl: FakeContentEl;
}

function createContentEl(): FakeContentEl {
	return {
		classList: new FakeClassList(),
		styles: {},
		setCssStyles(styles: Record<string, string>): void {
			Object.assign(this.styles, styles);
		},
	};
}

function createNode(
	id: string,
	scale?: number,
	dataOverrides: Partial<CanvasContentScaleNodeData> = {},
): FakeNode {
	const contentEl = createContentEl();
	const data: CanvasContentScaleNodeData = {
		id,
		type: "text",
		...dataOverrides,
		...(scale === undefined ? {} : {drawInCanvasScale: scale}),
	};

	const node: FakeNode = {
		id,
		data,
		getDataCalls: 0,
		contentEl,
		nodeEl: {
			querySelector(selector: string): FakeContentEl | null {
				return selector === ".canvas-node-content" ? contentEl : null;
			},
		} as unknown as HTMLElement,
		getData(): CanvasContentScaleNodeData {
			node.getDataCalls++;
			return data;
		},
	};

	return node;
}

function createScenario(nodeCount: number, scaledNodeIndex: number): {
	canvas: CanvasContentScaleCanvas;
	containerEl: HTMLElement;
	nodes: FakeNode[];
} {
	const nodes: FakeNode[] = [];
	const nodesById = new Map<string, CanvasContentScaleNode>();

	for (let index = 0; index < nodeCount; index++) {
		const node = createNode(`node-${index}`, index === scaledNodeIndex ? 0.5 : undefined);
		nodes.push(node);
		nodesById.set(`node-${index}`, node);
	}

	const containerEl = {
		querySelectorAll(selector: string): FakeContentEl[] {
			if (selector !== `.${CONTENT_SCALE_CLASS}`) {
				return [];
			}

			return nodes
				.map((node) => node.contentEl)
				.filter((contentEl) => contentEl.classList.contains(CONTENT_SCALE_CLASS));
		},
	} as unknown as HTMLElement;

	return {
		canvas: {nodes: nodesById},
		containerEl,
		nodes,
	};
}

function resetGetDataCalls(nodes: FakeNode[]): void {
	for (const node of nodes) {
		node.getDataCalls = 0;
	}
}

function getTotalGetDataCalls(nodes: FakeNode[]): number {
	return nodes.reduce((total, node) => total + node.getDataCalls, 0);
}

void test("markdown file canvas nodes are eligible for scale-button content scaling", () => {
	const markdownFileNode = createNode("markdown-file", undefined, {
		type: "file",
		file: "Notes/List of past exam papers.md",
	});

	assert.equal(getNextNodeContentScale(markdownFileNode, 0.8), 0.8);
});

void test("content-scale sync applies saved scales to markdown file canvas nodes", () => {
	const scenario = createScenario(1, 0);
	const markdownFileNode = scenario.nodes[0];

	assert.ok(markdownFileNode);
	markdownFileNode.data.type = "file";
	markdownFileNode.data.file = "Notes/List of past exam papers.md";

	const contentScaleSync = new NativeCanvasContentScaleSync(() => scenario.containerEl);
	contentScaleSync.syncForCanvas(scenario.canvas);

	assert.equal(markdownFileNode.contentEl.classList.contains(CONTENT_SCALE_CLASS), true);
	assert.equal(markdownFileNode.contentEl.styles.transform, "scale(0.5)");
});

void test("content-scale sync does not scale non-markdown file canvas nodes", () => {
	const scenario = createScenario(1, 0);
	const imageFileNode = scenario.nodes[0];

	assert.ok(imageFileNode);
	imageFileNode.data.type = "file";
	imageFileNode.data.file = "Images/example.png";

	const contentScaleSync = new NativeCanvasContentScaleSync(() => scenario.containerEl);
	contentScaleSync.syncForCanvas(scenario.canvas);

	assert.equal(imageFileNode.contentEl.classList.contains(CONTENT_SCALE_CLASS), false);
	assert.equal(imageFileNode.contentEl.styles.transform, "");
});

void test("content-scale sync rechecks tracked scaled text nodes instead of rescanning every canvas node", () => {
	const scenario = createScenario(100, 42);
	const contentScaleSync = new NativeCanvasContentScaleSync(() => scenario.containerEl);

	contentScaleSync.syncForCanvas(scenario.canvas);
	assert.equal(getTotalGetDataCalls(scenario.nodes), 100);
	assert.equal(scenario.nodes[42]?.contentEl.classList.contains(CONTENT_SCALE_CLASS), true);

	resetGetDataCalls(scenario.nodes);
	contentScaleSync.syncForCanvas(scenario.canvas);

	assert.equal(getTotalGetDataCalls(scenario.nodes), 1);
	assert.equal(scenario.nodes[42]?.getDataCalls, 1);
	assert.equal(scenario.nodes[0]?.getDataCalls, 0);
});

void test("content-scale sync updates changed scaled text nodes without a full canvas scan", () => {
	const scenario = createScenario(100, -1);
	const contentScaleSync = new NativeCanvasContentScaleSync(() => scenario.containerEl);
	const changedNode = scenario.nodes[42];

	assert.ok(changedNode);
	contentScaleSync.syncForCanvas(scenario.canvas);
	resetGetDataCalls(scenario.nodes);

	changedNode.data.drawInCanvasScale = 0.5;
	contentScaleSync.syncChangedNodes(scenario.canvas, [changedNode]);

	assert.equal(getTotalGetDataCalls(scenario.nodes), 1);
	assert.equal(changedNode.contentEl.classList.contains(CONTENT_SCALE_CLASS), true);
});

void test("content-scale sync keeps changed text nodes tracked after returning to default scale", () => {
	const scenario = createScenario(100, -1);
	const contentScaleSync = new NativeCanvasContentScaleSync(() => scenario.containerEl);
	const changedNode = scenario.nodes[42];

	assert.ok(changedNode);
	contentScaleSync.syncForCanvas(scenario.canvas);

	changedNode.data.drawInCanvasScale = 0.5;
	contentScaleSync.syncChangedNodes(scenario.canvas, [changedNode]);
	changedNode.data.drawInCanvasScale = undefined;
	contentScaleSync.syncChangedNodes(scenario.canvas, [changedNode]);
	assert.equal(changedNode.contentEl.classList.contains(CONTENT_SCALE_CLASS), false);

	resetGetDataCalls(scenario.nodes);
	changedNode.data.drawInCanvasScale = 0.25;
	contentScaleSync.syncForCanvas(scenario.canvas);

	assert.equal(getTotalGetDataCalls(scenario.nodes), 1);
	assert.equal(changedNode.contentEl.classList.contains(CONTENT_SCALE_CLASS), true);
});

void test("content-scale sync does a full pass when the native node map size changes", () => {
	const scenario = createScenario(100, 42);
	const contentScaleSync = new NativeCanvasContentScaleSync(() => scenario.containerEl);

	contentScaleSync.syncForCanvas(scenario.canvas);
	resetGetDataCalls(scenario.nodes);

	const addedNode = createNode("node-100", 0.25);
	scenario.nodes.push(addedNode);
	scenario.canvas.nodes?.set("node-100", addedNode);
	contentScaleSync.syncForCanvas(scenario.canvas);

	assert.equal(getTotalGetDataCalls(scenario.nodes), 101);
	assert.equal(addedNode.contentEl.classList.contains(CONTENT_SCALE_CLASS), true);
});
