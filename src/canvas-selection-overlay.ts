import {DEFAULT_MAX_NATIVE_CANVAS_ZOOM} from "./canvas-zoom-limits.ts";

// Obsidian expands Canvas selection overlays by 10 canvas units. That becomes a very large
// screen-space jump after the plugin lifts the native zoom cap, so keep drag-selection exact
// and cap selected-group padding to the same screen size Obsidian uses at its default max zoom.

const NATIVE_SELECTION_OVERLAY_PADDING = 10;
const DEFAULT_MAX_NATIVE_CANVAS_SCALE = 2 ** DEFAULT_MAX_NATIVE_CANVAS_ZOOM;

export interface NativeCanvasSelectionOverlayBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface NativeCanvasSelectionOverlayPatchCanvas {
	scale?: number;
	menu?: {
		selection?: NativeCanvasSelectionOverlayPatchInstance;
	};
}

export interface NativeCanvasSelectionOverlayPatchPrototype {
	update?: NativeCanvasSelectionOverlayUpdateFunction;
}

type NativeCanvasSelectionOverlayUpdateFunction = (
	this: NativeCanvasSelectionOverlayPatchInstance,
	bounds: NativeCanvasSelectionOverlayBounds,
) => void;

interface NativeCanvasSelectionOverlayPatchInstance extends NativeCanvasSelectionOverlayPatchPrototype {
	bbox?: NativeCanvasSelectionOverlayBounds;
	canvas?: {
		canvasEl?: AppendableElement;
		scale?: number;
	};
	selectionEl?: StyleableElement;
	resizerEls?: AppendableElement[];
}

interface NativeCanvasSelectionOverlayPatch {
	original: NativeCanvasSelectionOverlayUpdateFunction;
	patched: NativeCanvasSelectionOverlayUpdateFunction;
	hadOwnUpdate: boolean;
	refCount: number;
}

interface AppendableElement {
	parentNode?: unknown;
	appendChild?: (child: unknown) => unknown;
}

interface StyleableElement extends AppendableElement {
	classList?: {
		contains?: (className: string) => boolean;
	};
	className?: unknown;
	setCssStyles?: (styles: Record<string, string>) => void;
	style?: {
		setProperty?: (propertyName: string, value: string) => void;
		transform?: string;
		width?: string;
		height?: string;
	};
}

const nativeCanvasSelectionOverlayPatches = new WeakMap<NativeCanvasSelectionOverlayPatchPrototype, NativeCanvasSelectionOverlayPatch>();

export function getNativeCanvasSelectionOverlayPatchPrototype(
	canvas: NativeCanvasSelectionOverlayPatchCanvas,
): NativeCanvasSelectionOverlayPatchPrototype | null {
	const selectionOverlay = canvas.menu?.selection;

	if (!selectionOverlay) {
		return null;
	}

	return getUpdateOwner(selectionOverlay);
}

export function acquirePreciseNativeCanvasSelectionOverlayPatch(
	prototype: NativeCanvasSelectionOverlayPatchPrototype,
): () => void {
	const existingPatch = nativeCanvasSelectionOverlayPatches.get(prototype);

	if (existingPatch) {
		existingPatch.refCount++;
		return () => releasePreciseNativeCanvasSelectionOverlayPatch(prototype);
	}

	const original = prototype.update;
	const hadOwnUpdate = Object.prototype.hasOwnProperty.call(prototype, "update");

	if (!isNativeCanvasSelectionOverlayUpdate(original)) {
		return noop;
	}

	const patch: NativeCanvasSelectionOverlayPatch = {
		original,
		patched: createPreciseNativeCanvasSelectionOverlayUpdate(original),
		hadOwnUpdate,
		refCount: 1,
	};

	prototype.update = patch.patched;
	nativeCanvasSelectionOverlayPatches.set(prototype, patch);
	return () => releasePreciseNativeCanvasSelectionOverlayPatch(prototype);
}

function releasePreciseNativeCanvasSelectionOverlayPatch(prototype: NativeCanvasSelectionOverlayPatchPrototype): void {
	const patch = nativeCanvasSelectionOverlayPatches.get(prototype);

	if (!patch) {
		return;
	}

	patch.refCount--;

	if (patch.refCount > 0) {
		return;
	}

	if (prototype.update === patch.patched) {
		if (patch.hadOwnUpdate) {
			prototype.update = patch.original;
		} else {
			delete prototype.update;
		}
	}

	nativeCanvasSelectionOverlayPatches.delete(prototype);
}

function createPreciseNativeCanvasSelectionOverlayUpdate(
	original: NativeCanvasSelectionOverlayUpdateFunction,
): NativeCanvasSelectionOverlayUpdateFunction {
	return function preciseNativeCanvasSelectionOverlayUpdate(
		this: NativeCanvasSelectionOverlayPatchInstance,
		bounds: NativeCanvasSelectionOverlayBounds,
	): void {
		if (!canRenderSelectionOverlay(this, bounds)) {
			original.call(this, bounds);
			return;
		}

		try {
			renderSelectionOverlay(this, bounds);
		} catch {
			original.call(this, bounds);
		}
	};
}

function renderSelectionOverlay(
	overlay: NativeCanvasSelectionOverlayPatchInstance,
	bounds: NativeCanvasSelectionOverlayBounds,
): void {
	const selectionEl = overlay.selectionEl as StyleableElement;
	const canvasEl = overlay.canvas?.canvasEl as AppendableElement;

	overlay.bbox = bounds;

	if (!selectionEl.parentNode) {
		canvasEl.appendChild?.(selectionEl);
	}

	for (const resizerEl of overlay.resizerEls ?? []) {
		selectionEl.appendChild?.(resizerEl);
	}

	const padding = getSelectionOverlayPadding(overlay);
	const visualBounds = expandBounds(bounds, padding);

	setCssStyles(selectionEl, {
		transform: `translate(${formatCssPixels(visualBounds.minX)}, ${formatCssPixels(visualBounds.minY)})`,
		width: formatCssPixels(visualBounds.maxX - visualBounds.minX),
		height: formatCssPixels(visualBounds.maxY - visualBounds.minY),
	});
}

function getSelectionOverlayPadding(overlay: NativeCanvasSelectionOverlayPatchInstance): number {
	if (isDragSelectionOverlay(overlay)) {
		return 0;
	}

	const scale = overlay.canvas?.scale;

	if (!isPositiveFiniteNumber(scale) || scale <= DEFAULT_MAX_NATIVE_CANVAS_SCALE) {
		return NATIVE_SELECTION_OVERLAY_PADDING;
	}

	return NATIVE_SELECTION_OVERLAY_PADDING * DEFAULT_MAX_NATIVE_CANVAS_SCALE / scale;
}

function isDragSelectionOverlay(overlay: NativeCanvasSelectionOverlayPatchInstance): boolean {
	const selectionEl = overlay.selectionEl;
	return Boolean(selectionEl)
		&& !elementHasClass(selectionEl, "mod-group-selection")
		&& !elementHasClass(selectionEl, "mod-node-highlight");
}

function expandBounds(bounds: NativeCanvasSelectionOverlayBounds, padding: number): NativeCanvasSelectionOverlayBounds {
	return {
		minX: bounds.minX - padding,
		minY: bounds.minY - padding,
		maxX: bounds.maxX + padding,
		maxY: bounds.maxY + padding,
	};
}

function canRenderSelectionOverlay(
	overlay: NativeCanvasSelectionOverlayPatchInstance,
	bounds: NativeCanvasSelectionOverlayBounds,
): boolean {
	return isFiniteBounds(bounds)
		&& Boolean(overlay.selectionEl)
		&& Boolean(overlay.canvas?.canvasEl);
}

function isFiniteBounds(bounds: NativeCanvasSelectionOverlayBounds): boolean {
	return isFiniteNumber(bounds.minX)
		&& isFiniteNumber(bounds.minY)
		&& isFiniteNumber(bounds.maxX)
		&& isFiniteNumber(bounds.maxY);
}

function getUpdateOwner(instance: NativeCanvasSelectionOverlayPatchInstance): NativeCanvasSelectionOverlayPatchPrototype | null {
	let prototype = Object.getPrototypeOf(instance) as NativeCanvasSelectionOverlayPatchPrototype | null;

	while (prototype && prototype !== Object.prototype) {
		if (Object.prototype.hasOwnProperty.call(prototype, "update")) {
			return nativeCanvasSelectionOverlayPatches.has(prototype) || isNativeCanvasSelectionOverlayUpdate(prototype.update)
				? prototype
				: null;
		}

		prototype = Object.getPrototypeOf(prototype) as NativeCanvasSelectionOverlayPatchPrototype | null;
	}

	if (Object.prototype.hasOwnProperty.call(instance, "update")) {
		return nativeCanvasSelectionOverlayPatches.has(instance) || isNativeCanvasSelectionOverlayUpdate(instance.update)
			? instance
			: null;
	}

	return null;
}

function isNativeCanvasSelectionOverlayUpdate(value: unknown): value is NativeCanvasSelectionOverlayUpdateFunction {
	if (typeof value !== "function") {
		return false;
	}

	const source = Function.prototype.toString.call(value);
	return source.includes("selectionEl")
		&& source.includes("resizerEls")
		&& source.includes("setCssStyles")
		&& source.includes("10");
}

function setCssStyles(element: StyleableElement, styles: Record<string, string>): void {
	if (typeof element.setCssStyles === "function") {
		element.setCssStyles(styles);
		return;
	}

	for (const [propertyName, value] of Object.entries(styles)) {
		if (typeof element.style?.setProperty === "function") {
			element.style.setProperty(propertyName, value);
		} else if (element.style) {
			element.style[propertyName as "transform" | "width" | "height"] = value;
		}
	}
}

function elementHasClass(element: StyleableElement | undefined, className: string): boolean {
	if (!element) {
		return false;
	}

	if (typeof element.classList?.contains === "function" && element.classList.contains(className)) {
		return true;
	}

	return getElementClassNames(element).includes(className);
}

function getElementClassNames(element: StyleableElement): string[] {
	const className = element.className;

	if (typeof className === "string") {
		return className.split(/\s+/).filter((value) => value.length > 0);
	}

	if (className && typeof className === "object" && "baseVal" in className) {
		const baseVal = (className as {baseVal?: unknown}).baseVal;
		return typeof baseVal === "string" ? baseVal.split(/\s+/).filter((value) => value.length > 0) : [];
	}

	return [];
}

function formatCssPixels(value: number): string {
	return `${Number(value.toFixed(6)).toString()}px`;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
	return isFiniteNumber(value) && value > 0;
}

function noop(): void {}
