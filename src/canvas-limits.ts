import type {CanvasTarget} from "./canvas-target";
import {getNativeCanvasGridSpacingForTinyElements, getNativeCanvasSnapDistanceForTinyElements} from "./canvas-snapping.ts";
import {
	DEFAULT_MAX_NATIVE_CANVAS_ZOOM,
	DEFAULT_MIN_NATIVE_CANVAS_ZOOM,
	clampNativeCanvasScaleForTinyElements,
	clampNativeCanvasZoomForTinyElements,
} from "./canvas-zoom-limits.ts";

// Obsidian's Canvas API is internal, so keep the native canvas patches isolated here.

const TINY_CANVAS_MIN_DIMENSION = 1;
const CANVAS_ZOOM_PADDING = 1.1;

interface NativeCanvasBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface NativeCanvasConfig {
	minContainerDimension?: number;
	objectSnapDistance?: number;
}

interface NativeCanvasRect {
	width: number;
	height: number;
}

interface NativeCanvasPoint {
	x: number;
	y: number;
}

interface NativeCanvasElement extends HTMLElement {
	win: Window;
}

type NativeCanvasRequestFrame = (timestamp?: number) => void;
type NativeCanvasZoomToBbox = (bounds: NativeCanvasBounds) => void;
type NativeMathClamp = (value: number, min: number, max: number) => number;

interface NativeCanvasInstance {
	config?: NativeCanvasConfig;
	canvasEl?: NativeCanvasElement;
	canvasRect?: NativeCanvasRect;
	tx?: number;
	ty?: number;
	zoom?: number;
	tZoom?: number;
	gridSpacing?: number;
	scale?: number;
	snapDistance?: number;
	zoomCenter?: NativeCanvasPoint | null;
	requestFrame?: NativeCanvasRequestFrame;
	markViewportChanged?: () => void;
	zoomToBbox?: NativeCanvasZoomToBbox;
}

type CanvasViewWithCanvas = CanvasTarget["view"] & {
	canvas?: NativeCanvasInstance | null;
};

type MathWithClamp = typeof Math & {
	clamp?: NativeMathClamp;
};

export class NativeCanvasInteractionLimits {
	private canvas: NativeCanvasInstance | null = null;
	private hasOriginalMinContainerDimension = false;
	private originalMinContainerDimension: number | undefined;
	private isRequestFramePatched = false;
	private hadOwnRequestFrame = false;
	private originalRequestFrame: NativeCanvasRequestFrame | undefined;
	private patchedRequestFrame: NativeCanvasRequestFrame | undefined;
	private isZoomToBboxPatched = false;
	private hadOwnZoomToBbox = false;
	private originalZoomToBbox: NativeCanvasZoomToBbox | undefined;
	private patchedZoomToBbox: NativeCanvasZoomToBbox | undefined;
	private isGridSpacingPatched = false;
	private hadOwnGridSpacing = false;
	private originalGridSpacingDescriptor: PropertyDescriptor | undefined;
	private patchedGridSpacingGetter: (() => number) | undefined;
	private isSnapDistancePatched = false;
	private hadOwnSnapDistance = false;
	private originalSnapDistanceDescriptor: PropertyDescriptor | undefined;
	private patchedSnapDistanceGetter: (() => number) | undefined;
	private readonly target: CanvasTarget;

	constructor(target: CanvasTarget) {
		this.target = target;
	}

	setEnabled(enabled: boolean): void {
		const canvas = getNativeCanvas(this.target);

		if (!enabled || !canvas) {
			this.restore();
			return;
		}

		if (this.canvas && this.canvas !== canvas) {
			this.restore();
		}

		this.canvas = canvas;
		this.applyMinimumDimensionOverride(canvas);
		this.applyZoomOverrides(canvas);
	}

	dispose(): void {
		this.restore();
	}

	private applyMinimumDimensionOverride(canvas: NativeCanvasInstance): void {
		if (!canvas.config) {
			return;
		}

		if (!this.hasOriginalMinContainerDimension) {
			this.originalMinContainerDimension = canvas.config.minContainerDimension;
			this.hasOriginalMinContainerDimension = true;
		}

		canvas.config.minContainerDimension = TINY_CANVAS_MIN_DIMENSION;
	}

	private applyZoomOverrides(canvas: NativeCanvasInstance): void {
		this.patchRequestFrame(canvas);
		this.patchZoomToBbox(canvas);
		this.patchGridSpacing(canvas);
		this.patchSnapDistance(canvas);
	}

	private patchRequestFrame(canvas: NativeCanvasInstance): void {
		if (this.isRequestFramePatched || typeof canvas.requestFrame !== "function") {
			return;
		}

		const originalRequestFrame = canvas.requestFrame;
		this.hadOwnRequestFrame = Object.prototype.hasOwnProperty.call(canvas, "requestFrame");
		this.originalRequestFrame = originalRequestFrame;
		// Canvas rendering hard-clamps Math.clamp(tZoom, -4, 1). Wrap only the scheduled frame callback and replace the native upper bound with our benchmarked cap.
		const patchedRequestFrame: NativeCanvasRequestFrame = (timestamp?: number): void => {
			const frameWindow = canvas.canvasEl?.win ?? window;
			const originalRequestAnimationFrame = Reflect.get(frameWindow, "requestAnimationFrame");
			const requestAnimationFrame = originalRequestAnimationFrame.bind(frameWindow);
			Reflect.set(frameWindow, "requestAnimationFrame", (callback: FrameRequestCallback): number => requestAnimationFrame(
				(frameTimestamp: DOMHighResTimeStamp) => {
					this.runWithZoomClampBypass(canvas, () => callback(frameTimestamp));
				},
			));

			try {
				originalRequestFrame.call(canvas, timestamp);
			} finally {
				Reflect.set(frameWindow, "requestAnimationFrame", originalRequestAnimationFrame);
			}
		};
		canvas.requestFrame = patchedRequestFrame;
		this.patchedRequestFrame = patchedRequestFrame;
		this.isRequestFramePatched = true;
	}

	private patchZoomToBbox(canvas: NativeCanvasInstance): void {
		if (this.isZoomToBboxPatched || typeof canvas.zoomToBbox !== "function") {
			return;
		}

		const originalZoomToBbox = canvas.zoomToBbox;
		this.hadOwnZoomToBbox = Object.prototype.hasOwnProperty.call(canvas, "zoomToBbox");
		this.originalZoomToBbox = originalZoomToBbox;
		const patchedZoomToBbox: NativeCanvasZoomToBbox = (bounds: NativeCanvasBounds): void => {
			if (!this.zoomToBboxWithoutUpperZoomLimit(canvas, bounds)) {
				originalZoomToBbox.call(canvas, bounds);
			}
		};
		canvas.zoomToBbox = patchedZoomToBbox;
		this.patchedZoomToBbox = patchedZoomToBbox;
		this.isZoomToBboxPatched = true;
	}

	private patchGridSpacing(canvas: NativeCanvasInstance): void {
		if (this.isGridSpacingPatched) {
			return;
		}

		const originalGridSpacingDescriptor = Object.getOwnPropertyDescriptor(canvas, "gridSpacing");

		if (originalGridSpacingDescriptor && !originalGridSpacingDescriptor.configurable) {
			return;
		}

		const patchedGridSpacingGetter = (): number => getNativeCanvasGridSpacingForTinyElements(getCurrentCanvasZoom(canvas));

		try {
			Object.defineProperty(canvas, "gridSpacing", {
				configurable: true,
				enumerable: originalGridSpacingDescriptor?.enumerable ?? false,
				get: patchedGridSpacingGetter,
			});
		} catch {
			return;
		}

		this.hadOwnGridSpacing = Boolean(originalGridSpacingDescriptor);
		this.originalGridSpacingDescriptor = originalGridSpacingDescriptor;
		this.patchedGridSpacingGetter = patchedGridSpacingGetter;
		this.isGridSpacingPatched = true;
	}

	private patchSnapDistance(canvas: NativeCanvasInstance): void {
		if (this.isSnapDistancePatched) {
			return;
		}

		const originalSnapDistanceDescriptor = Object.getOwnPropertyDescriptor(canvas, "snapDistance");

		if (originalSnapDistanceDescriptor && !originalSnapDistanceDescriptor.configurable) {
			return;
		}

		const patchedSnapDistanceGetter = (): number => getNativeCanvasSnapDistanceForTinyElements(
			canvas.config?.objectSnapDistance,
			getCurrentCanvasScale(canvas),
		);

		try {
			Object.defineProperty(canvas, "snapDistance", {
				configurable: true,
				enumerable: originalSnapDistanceDescriptor?.enumerable ?? false,
				get: patchedSnapDistanceGetter,
			});
		} catch {
			return;
		}

		this.hadOwnSnapDistance = Boolean(originalSnapDistanceDescriptor);
		this.originalSnapDistanceDescriptor = originalSnapDistanceDescriptor;
		this.patchedSnapDistanceGetter = patchedSnapDistanceGetter;
		this.isSnapDistancePatched = true;
	}

	private zoomToBboxWithoutUpperZoomLimit(canvas: NativeCanvasInstance, bounds: NativeCanvasBounds): boolean {
		const canvasRect = canvas.canvasRect;

		if (!canvasRect || typeof canvas.markViewportChanged !== "function") {
			return false;
		}

		const viewportWidth = canvasRect.width;
		const viewportHeight = canvasRect.height;
		const boundsWidth = bounds.maxX - bounds.minX;
		const boundsHeight = bounds.maxY - bounds.minY;

		if (!isPositiveFiniteNumber(viewportWidth)
			|| !isPositiveFiniteNumber(viewportHeight)
			|| !isPositiveFiniteNumber(boundsWidth)
			|| !isPositiveFiniteNumber(boundsHeight)) {
			return false;
		}

		const rawScale = Math.min(
			viewportWidth / (CANVAS_ZOOM_PADDING * boundsWidth),
			viewportHeight / (CANVAS_ZOOM_PADDING * boundsHeight),
		);

		if (!isPositiveFiniteNumber(rawScale)) {
			return false;
		}

		const scale = clampNativeCanvasScaleForTinyElements(rawScale);
		canvas.tx = (bounds.minX + bounds.maxX) / 2;
		canvas.ty = (bounds.minY + bounds.maxY) / 2;
		canvas.zoomCenter = null;
		canvas.tZoom = Math.log2(scale);
		canvas.markViewportChanged();
		return true;
	}

	private runWithZoomClampBypass(canvas: NativeCanvasInstance, callback: () => void): void {
		const mathWithClamp = Math as MathWithClamp;
		const originalClamp = mathWithClamp.clamp;

		if (typeof originalClamp !== "function" || !this.shouldBypassZoomClamp(canvas)) {
			callback();
			return;
		}

		mathWithClamp.clamp = (value: number, min: number, max: number): number => {
			if (min === DEFAULT_MIN_NATIVE_CANVAS_ZOOM
				&& max === DEFAULT_MAX_NATIVE_CANVAS_ZOOM
				&& value > DEFAULT_MAX_NATIVE_CANVAS_ZOOM) {
				return clampNativeCanvasZoomForTinyElements(value);
			}

			return originalClamp(value, min, max);
		};

		try {
			callback();
		} finally {
			mathWithClamp.clamp = originalClamp;
		}
	}

	private shouldBypassZoomClamp(canvas: NativeCanvasInstance): boolean {
		if (canvas !== this.canvas) {
			return false;
		}

		const targetZoom = typeof canvas.tZoom === "number" ? canvas.tZoom : canvas.zoom;
		return typeof targetZoom === "number"
			&& Number.isFinite(targetZoom)
			&& targetZoom > DEFAULT_MAX_NATIVE_CANVAS_ZOOM;
	}

	private restore(): void {
		const canvas = this.canvas;

		if (!canvas) {
			return;
		}

		this.restoreMinimumDimensionOverride(canvas);
		this.restoreZoomOverrides(canvas);
		this.canvas = null;
	}

	private restoreMinimumDimensionOverride(canvas: NativeCanvasInstance): void {
		if (this.hasOriginalMinContainerDimension
			&& canvas.config
			&& canvas.config.minContainerDimension === TINY_CANVAS_MIN_DIMENSION) {
			canvas.config.minContainerDimension = this.originalMinContainerDimension;
		}

		this.hasOriginalMinContainerDimension = false;
		this.originalMinContainerDimension = undefined;
	}

	private restoreZoomOverrides(canvas: NativeCanvasInstance): void {
		this.restoreRequestFrame(canvas);
		this.restoreZoomToBbox(canvas);
		this.restoreGridSpacing(canvas);
		this.restoreSnapDistance(canvas);
		this.restoreNativeZoomClamp(canvas);
	}

	private restoreNativeZoomClamp(canvas: NativeCanvasInstance): void {
		if (typeof canvas.tZoom !== "number" || canvas.tZoom <= DEFAULT_MAX_NATIVE_CANVAS_ZOOM) {
			return;
		}

		canvas.tZoom = DEFAULT_MAX_NATIVE_CANVAS_ZOOM;
		canvas.markViewportChanged?.();
	}

	private restoreRequestFrame(canvas: NativeCanvasInstance): void {
		if (!this.isRequestFramePatched) {
			return;
		}

		if (canvas.requestFrame === this.patchedRequestFrame) {
			if (this.hadOwnRequestFrame) {
				canvas.requestFrame = this.originalRequestFrame;
			} else {
				delete canvas.requestFrame;
			}
		}

		this.isRequestFramePatched = false;
		this.hadOwnRequestFrame = false;
		this.originalRequestFrame = undefined;
		this.patchedRequestFrame = undefined;
	}

	private restoreZoomToBbox(canvas: NativeCanvasInstance): void {
		if (!this.isZoomToBboxPatched) {
			return;
		}

		if (canvas.zoomToBbox === this.patchedZoomToBbox) {
			if (this.hadOwnZoomToBbox) {
				canvas.zoomToBbox = this.originalZoomToBbox;
			} else {
				delete canvas.zoomToBbox;
			}
		}

		this.isZoomToBboxPatched = false;
		this.hadOwnZoomToBbox = false;
		this.originalZoomToBbox = undefined;
		this.patchedZoomToBbox = undefined;
	}

	private restoreGridSpacing(canvas: NativeCanvasInstance): void {
		if (!this.isGridSpacingPatched) {
			return;
		}

		const currentDescriptor = Object.getOwnPropertyDescriptor(canvas, "gridSpacing");

		if (currentDescriptor?.get === this.patchedGridSpacingGetter) {
			if (this.hadOwnGridSpacing && this.originalGridSpacingDescriptor) {
				Object.defineProperty(canvas, "gridSpacing", this.originalGridSpacingDescriptor);
			} else {
				delete canvas.gridSpacing;
			}
		}

		this.isGridSpacingPatched = false;
		this.hadOwnGridSpacing = false;
		this.originalGridSpacingDescriptor = undefined;
		this.patchedGridSpacingGetter = undefined;
	}

	private restoreSnapDistance(canvas: NativeCanvasInstance): void {
		if (!this.isSnapDistancePatched) {
			return;
		}

		const currentDescriptor = Object.getOwnPropertyDescriptor(canvas, "snapDistance");

		if (currentDescriptor?.get === this.patchedSnapDistanceGetter) {
			if (this.hadOwnSnapDistance && this.originalSnapDistanceDescriptor) {
				Object.defineProperty(canvas, "snapDistance", this.originalSnapDistanceDescriptor);
			} else {
				delete canvas.snapDistance;
			}
		}

		this.isSnapDistancePatched = false;
		this.hadOwnSnapDistance = false;
		this.originalSnapDistanceDescriptor = undefined;
		this.patchedSnapDistanceGetter = undefined;
	}
}

function getNativeCanvas(target: CanvasTarget): NativeCanvasInstance | null {
	return ((target.view as CanvasViewWithCanvas).canvas ?? null);
}

function getCurrentCanvasZoom(canvas: NativeCanvasInstance): number {
	if (typeof canvas.zoom === "number" && Number.isFinite(canvas.zoom)) {
		return canvas.zoom;
	}

	return typeof canvas.tZoom === "number" ? canvas.tZoom : DEFAULT_MAX_NATIVE_CANVAS_ZOOM;
}

function getCurrentCanvasScale(canvas: NativeCanvasInstance): number {
	if (isPositiveFiniteNumber(canvas.scale)) {
		return canvas.scale;
	}

	return 2 ** getCurrentCanvasZoom(canvas);
}

function isPositiveFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}
