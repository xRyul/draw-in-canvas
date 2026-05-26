import assert from "node:assert/strict";
import test from "node:test";

import {
	acquirePreciseNativeCanvasSelectionOverlayPatch,
	getNativeCanvasSelectionOverlayPatchPrototype,
	type NativeCanvasSelectionOverlayBounds,
} from "../src/canvas-selection-overlay.ts";

class FakeElement {
	parentNode: FakeElement | null = null;
	readonly children: FakeElement[] = [];
	readonly styles: Record<string, string> = {};
	className: string;
	classList: {contains: (className: string) => boolean};

	constructor(classNames: readonly string[] = []) {
		this.className = classNames.join(" ");
		this.classList = {
			contains: (className: string) => this.className.split(/\s+/).includes(className),
		};
	}

	appendChild(child: FakeElement): FakeElement {
		child.parentNode = this;
		this.children.push(child);
		return child;
	}

	setCssStyles(styles: Record<string, string>): void {
		Object.assign(this.styles, styles);
	}
}

class FakeSelectionOverlay {
	bbox: NativeCanvasSelectionOverlayBounds | undefined;
	readonly selectionEl: FakeElement;
	readonly resizerEls = [new FakeElement(["canvas-node-resizer"]), new FakeElement(["canvas-node-resizer"])];
	readonly canvas: {scale: number; canvasEl: FakeElement};

	constructor(scale: number, selectionClassNames: readonly string[]) {
		this.selectionEl = new FakeElement(selectionClassNames);
		this.canvas = {scale, canvasEl: new FakeElement(["canvas"])};
	}

	update(bounds: NativeCanvasSelectionOverlayBounds): void {
		this.bbox = bounds;
		const selectionEl = this.selectionEl;
		const resizerEls = this.resizerEls;

		if (!selectionEl.parentNode) {
			this.canvas.canvasEl.appendChild(selectionEl);
		}

		for (const resizerEl of resizerEls) {
			selectionEl.appendChild(resizerEl);
		}

		const paddedBounds = expandTestBounds(bounds, 10);
		selectionEl.setCssStyles({
			transform: `translate(${paddedBounds.minX}px, ${paddedBounds.minY}px)`,
			width: `${paddedBounds.maxX - paddedBounds.minX}px`,
			height: `${paddedBounds.maxY - paddedBounds.minY}px`,
		});
	}
}

void test("patch prototype discovery finds Obsidian's canvas selection overlay update owner", () => {
	const overlay = new FakeSelectionOverlay(16, ["canvas-selection"]);

	assert.equal(
		getNativeCanvasSelectionOverlayPatchPrototype({menu: {selection: overlay}}),
		FakeSelectionOverlay.prototype,
	);
});

void test("drag-to-select overlay follows the exact pointer bounds at high zoom", () => {
	const release = acquirePreciseNativeCanvasSelectionOverlayPatch(FakeSelectionOverlay.prototype);

	try {
		const overlay = new FakeSelectionOverlay(16, ["canvas-selection"]);
		overlay.update({minX: 10, minY: 20, maxX: 11, maxY: 21});

		assert.deepEqual(overlay.selectionEl.styles, {
			transform: "translate(10px, 20px)",
			width: "1px",
			height: "1px",
		});
		assert.equal(overlay.selectionEl.parentNode, overlay.canvas.canvasEl);
		assert.equal(overlay.selectionEl.children.length, 2);
	} finally {
		release();
	}
});

void test("selected group overlay keeps native padding until the default max zoom and caps it after", () => {
	const release = acquirePreciseNativeCanvasSelectionOverlayPatch(FakeSelectionOverlay.prototype);

	try {
		const overlay = new FakeSelectionOverlay(8, ["canvas-selection", "mod-group-selection"]);
		overlay.update({minX: 10, minY: 20, maxX: 50, maxY: 80});

		assert.deepEqual(overlay.selectionEl.styles, {
			transform: "translate(7.5px, 17.5px)",
			width: "45px",
			height: "65px",
		});
	} finally {
		release();
	}
});

void test("canvas selection overlay patch is reference counted and restores the native update", () => {
	const originalUpdate = getFakeSelectionOverlayUpdate();
	const releaseFirst = acquirePreciseNativeCanvasSelectionOverlayPatch(FakeSelectionOverlay.prototype);
	const patchedUpdate = getFakeSelectionOverlayUpdate();
	const releaseSecond = acquirePreciseNativeCanvasSelectionOverlayPatch(FakeSelectionOverlay.prototype);

	assert.notEqual(patchedUpdate, originalUpdate);

	releaseFirst();
	assert.equal(getFakeSelectionOverlayUpdate(), patchedUpdate);

	releaseSecond();
	assert.equal(getFakeSelectionOverlayUpdate(), originalUpdate);
});

function getFakeSelectionOverlayUpdate(): unknown {
	return Object.getOwnPropertyDescriptor(FakeSelectionOverlay.prototype, "update")?.value;
}

function expandTestBounds(bounds: NativeCanvasSelectionOverlayBounds, padding: number): NativeCanvasSelectionOverlayBounds {
	return {
		minX: bounds.minX - padding,
		minY: bounds.minY - padding,
		maxX: bounds.maxX + padding,
		maxY: bounds.maxY + padding,
	};
}
