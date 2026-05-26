// Obsidian's Canvas node z-index rendering is internal. Keep the selection-front patch isolated here.

export interface StableCanvasNodeZIndexPatchCanvas {
	nodes?: ReadonlyMap<string, StableCanvasNodeZIndexPatchNode>;
}

export interface StableCanvasNodeZIndexPatchNode {
	zIndex?: number;
	renderedZIndex?: number;
	nodeEl?: {style: {zIndex: string}};
	renderZIndex?: StableCanvasNodeZIndexRenderFunction;
}

export interface StableCanvasNodeZIndexPatchPrototype {
	renderZIndex?: StableCanvasNodeZIndexRenderFunction;
}

type StableCanvasNodeZIndexRenderFunction = (this: StableCanvasNodeZIndexPatchNode) => void;

interface StableCanvasNodeZIndexPatch {
	original: StableCanvasNodeZIndexRenderFunction;
	patched: StableCanvasNodeZIndexRenderFunction;
	hadOwnRenderZIndex: boolean;
	refCount: number;
}

const stableCanvasNodeZIndexPatches = new WeakMap<StableCanvasNodeZIndexPatchPrototype, StableCanvasNodeZIndexPatch>();

export function getStableCanvasNodeZIndexPatchPrototypes(canvas: StableCanvasNodeZIndexPatchCanvas): StableCanvasNodeZIndexPatchPrototype[] {
	const prototypes = new Set<StableCanvasNodeZIndexPatchPrototype>();

	for (const node of canvas.nodes?.values() ?? []) {
		const prototype = getRenderZIndexOwner(node);

		if (!prototype || prototypes.has(prototype)) {
			continue;
		}

		if (stableCanvasNodeZIndexPatches.has(prototype) || isSelectionBoostedRenderZIndex(prototype.renderZIndex)) {
			prototypes.add(prototype);
		}
	}

	return Array.from(prototypes);
}

export function acquireStableCanvasNodeZIndexPatch(prototype: StableCanvasNodeZIndexPatchPrototype): () => void {
	const existingPatch = stableCanvasNodeZIndexPatches.get(prototype);

	if (existingPatch) {
		existingPatch.refCount++;
		return () => releaseStableCanvasNodeZIndexPatch(prototype);
	}

	const original = prototype.renderZIndex;
	const hadOwnRenderZIndex = Object.prototype.hasOwnProperty.call(prototype, "renderZIndex");

	if (!isSelectionBoostedRenderZIndex(original)) {
		return noop;
	}

	const patch: StableCanvasNodeZIndexPatch = {
		original,
		patched: createStableCanvasNodeZIndexRender(original),
		hadOwnRenderZIndex,
		refCount: 1,
	};

	prototype.renderZIndex = patch.patched;
	stableCanvasNodeZIndexPatches.set(prototype, patch);
	return () => releaseStableCanvasNodeZIndexPatch(prototype);
}

export function renderCanvasNodeZIndexes(canvas: StableCanvasNodeZIndexPatchCanvas): void {
	for (const node of canvas.nodes?.values() ?? []) {
		node.renderZIndex?.();
	}
}

function releaseStableCanvasNodeZIndexPatch(prototype: StableCanvasNodeZIndexPatchPrototype): void {
	const patch = stableCanvasNodeZIndexPatches.get(prototype);

	if (!patch) {
		return;
	}

	patch.refCount--;

	if (patch.refCount > 0) {
		return;
	}

	if (prototype.renderZIndex === patch.patched) {
		if (patch.hadOwnRenderZIndex) {
			prototype.renderZIndex = patch.original;
		} else {
			delete prototype.renderZIndex;
		}
	}

	stableCanvasNodeZIndexPatches.delete(prototype);
}

function createStableCanvasNodeZIndexRender(original: StableCanvasNodeZIndexRenderFunction): StableCanvasNodeZIndexRenderFunction {
	return function stableCanvasNodeZIndexRender(this: StableCanvasNodeZIndexPatchNode): void {
		if (!this.nodeEl) {
			original.call(this);
			return;
		}

		const zIndex = isFiniteNumber(this.zIndex) ? this.zIndex : 0;

		if (this.renderedZIndex !== zIndex) {
			this.nodeEl.style.zIndex = zIndex.toString();
			this.renderedZIndex = zIndex;
		}
	};
}

function getRenderZIndexOwner(node: StableCanvasNodeZIndexPatchNode): StableCanvasNodeZIndexPatchPrototype | null {
	let prototype = Object.getPrototypeOf(node) as StableCanvasNodeZIndexPatchPrototype | null;

	while (prototype && prototype !== Object.prototype) {
		if (Object.prototype.hasOwnProperty.call(prototype, "renderZIndex")) {
			return prototype;
		}

		prototype = Object.getPrototypeOf(prototype) as StableCanvasNodeZIndexPatchPrototype | null;
	}

	return Object.prototype.hasOwnProperty.call(node, "renderZIndex")
		? node
		: null;
}

function isSelectionBoostedRenderZIndex(value: unknown): value is StableCanvasNodeZIndexRenderFunction {
	if (typeof value !== "function") {
		return false;
	}

	const source = Function.prototype.toString.call(value);
	return source.includes("selection")
		&& source.includes("zIndexCounter")
		&& source.includes("renderedZIndex");
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function noop(): void {}
