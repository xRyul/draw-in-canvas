import {setIcon} from "obsidian";
import type {CanvasTarget} from "./canvas-target";

// Obsidian's Canvas API is internal, so keep native canvas element menu patches isolated here.

const CANVAS_ELEMENT_SCALE_STEP = 1.25;
const TINY_CANVAS_MIN_DIMENSION = 1;
const SCALE_BUTTON_CLASS = "draw-in-canvas-scale-button";
const SCALE_BUTTON_GROW_CLASS = "draw-in-canvas-scale-grow-button";
const SCALE_BUTTON_SHRINK_CLASS = "draw-in-canvas-scale-shrink-button";
const CONTENT_SCALE_DATA_KEY = "drawInCanvasScale";
const CONTENT_SCALE_CLASS = "draw-in-canvas-scaled-node-content";
const DEFAULT_CONTENT_SCALE = 1;
const MIN_CONTENT_SCALE = 0.01;
const MAX_CONTENT_SCALE = 100;
const CONTENT_SCALE_EPSILON = 0.001;
const ASPECT_RATIO_EPSILON = 0.0001;

interface NativeCanvasBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface NativeCanvasConfig {
	minContainerDimension?: number;
}

interface NativeCanvasRect {
	x: number;
	y: number;
	width: number;
	height: number;
}
type NativeCanvasResizePointerdown = (this: NativeCanvasNode, event: PointerEvent, resizeHandle: string) => void;

interface NativeCanvasNodeData extends Partial<NativeCanvasRect> {
	id?: string;
	type?: string;
	drawInCanvasScale?: number;
}

interface NativeCanvasNodeResizePrototype {
	onResizePointerdown?: NativeCanvasResizePointerdown;
}

interface AspectRatioResizePatch {
	original: NativeCanvasResizePointerdown;
	patched: NativeCanvasResizePointerdown;
	hadOwnResizePointerdown: boolean;
	refCount: number;
}

interface NativeCanvasNode extends NativeCanvasRect {
	id?: string;
	nodeEl?: HTMLElement;
	aspectRatio?: number;
	moveAndResize?: (rect: NativeCanvasRect) => void;
	setData?: (data: NativeCanvasNodeData) => void;
	getData?: () => NativeCanvasNodeData;
	getBBox?: () => NativeCanvasBounds;
	render?: () => void;
}

interface NativeCanvasMenu {
	render?: (rebuild?: boolean) => void;
}

interface NativeCanvasInstance {
	config?: NativeCanvasConfig;
	nodes?: Map<string, NativeCanvasNode>;
	selection?: Set<unknown>;
	menu?: NativeCanvasMenu;
	requestSave?: (pushHistory?: boolean) => void;
	requestFrame?: () => void;
}

type CanvasViewWithCanvas = CanvasTarget["view"] & {
	canvas?: NativeCanvasInstance | null;
};

type ScaleDirection = "grow" | "shrink";

const aspectRatioResizePatches = new WeakMap<NativeCanvasNodeResizePrototype, AspectRatioResizePatch>();

export class NativeCanvasElementScaleControls {
	private enabled = false;
	private readonly buttonEls: HTMLButtonElement[] = [];
	private readonly buttonDisposers: Array<() => void> = [];
	private readonly releaseResizePatches = new Map<NativeCanvasNodeResizePrototype, () => void>();
	private hasSyncedContentScales = false;
	private hasScaledContent = false;
	private contentScaleCanvas: NativeCanvasInstance | null = null;
	private hasContentScaleNodeMap = false;

	constructor(private readonly target: CanvasTarget) {}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;

		if (!enabled) {
			this.removeControls();
			this.releaseAspectRatioResizePatch();
			this.syncContentScalesIfNeeded();
			return;
		}

		this.sync();
	}

	syncForCanvasDomChange(): void {
		if (this.enabled) {
			this.sync();
			return;
		}

		this.syncContentScalesIfNeeded();
	}

	sync(): void {
		const canvas = getNativeCanvas(this.target);

		if (!canvas) {
			this.removeControls();
			this.clearContentScales();
			this.releaseAspectRatioResizePatch();
			return;
		}

		this.syncContentScales(canvas);

		if (!this.enabled) {
			this.removeControls();
			this.releaseAspectRatioResizePatch();
			return;
		}

		this.syncAspectRatioResizePatch(canvas);

		const menuEl = this.findNativeMenuEl();

		if (!menuEl || getSelectedResizableNodes(canvas).length === 0) {
			this.removeControls();
			return;
		}

		this.removeStaleControls(menuEl);

		if (this.areControlsMountedIn(menuEl)) {
			return;
		}

		this.removeControls();

		const growButtonEl = this.createScaleButton("grow");
		const shrinkButtonEl = this.createScaleButton("shrink");
		this.buttonEls.push(growButtonEl, shrinkButtonEl);
		this.insertButtons(menuEl, growButtonEl, shrinkButtonEl);
	}

	dispose(): void {
		this.enabled = false;
		this.removeControls();
		this.releaseAspectRatioResizePatch();
		this.clearContentScales();
	}

	getOwnedElements(): Element[] {
		return this.buttonEls.filter((buttonEl) => buttonEl.isConnected);
	}

	private createScaleButton(direction: ScaleDirection): HTMLButtonElement {
		const buttonEl = document.createElement("button");
		buttonEl.type = "button";
		buttonEl.classList.add("clickable-icon", SCALE_BUTTON_CLASS);
		buttonEl.classList.add(direction === "grow" ? SCALE_BUTTON_GROW_CLASS : SCALE_BUTTON_SHRINK_CLASS);
		buttonEl.setAttribute("aria-label", direction === "grow" ? "Make selected canvas item larger" : "Make selected canvas item smaller");
		buttonEl.setAttribute("data-tooltip-position", "top");
		setIcon(buttonEl, direction === "grow" ? "plus" : "minus");

		this.buttonDisposers.push(
			this.addListener(buttonEl, "pointerdown", this.handleButtonPointerDown),
			this.addListener(buttonEl, "click", (event: MouseEvent) => this.handleScaleButtonClick(event, direction)),
		);

		return buttonEl;
	}

	private insertButtons(menuEl: HTMLElement, growButtonEl: HTMLButtonElement, shrinkButtonEl: HTMLButtonElement): void {
		const insertionAnchor = findNativeMenuInsertionAnchor(menuEl);

		menuEl.insertBefore(growButtonEl, insertionAnchor);
		menuEl.insertBefore(shrinkButtonEl, insertionAnchor);
	}

	private areControlsMountedIn(menuEl: HTMLElement): boolean {
		return this.buttonEls.length === 2
			&& this.buttonEls.every((buttonEl) => buttonEl.isConnected && buttonEl.parentElement === menuEl);
	}

	private removeStaleControls(menuEl: HTMLElement): void {
		const knownButtons = new Set(this.buttonEls);
		const staleButtons = Array.from(this.target.containerEl.querySelectorAll<HTMLButtonElement>(`.${SCALE_BUTTON_CLASS}`));

		for (const buttonEl of staleButtons) {
			if (!knownButtons.has(buttonEl) || buttonEl.parentElement !== menuEl) {
				buttonEl.remove();
			}
		}
	}

	private removeControls(): void {
		for (const dispose of this.buttonDisposers.splice(0)) {
			dispose();
		}

		for (const buttonEl of this.buttonEls.splice(0)) {
			buttonEl.remove();
		}
	}

	private findNativeMenuEl(): HTMLElement | null {
		return this.target.containerEl.querySelector<HTMLElement>(".canvas-menu:not(.draw-in-canvas-stroke-scale-menu)");
	}

	private syncContentScales(canvas = getNativeCanvas(this.target)): void {
		if (!canvas?.nodes) {
			this.clearContentScales();
			this.contentScaleCanvas = canvas ?? null;
			this.hasContentScaleNodeMap = false;
			return;
		}

		const activeContentEls = new Set<HTMLElement>();
		let hasScaledContent = false;

		for (const node of canvas.nodes.values()) {
			const shouldScaleContent = shouldScaleNodeContent(node);
			const scale = shouldScaleContent ? getNodeContentScale(node) : DEFAULT_CONTENT_SCALE;
			const shouldApplyScale = shouldScaleContent && !isDefaultContentScale(scale);
			const contentEl = getNodeContentEl(node);

			if (shouldApplyScale) {
				hasScaledContent = true;
			}

			if (!contentEl) {
				continue;
			}

			if (!shouldApplyScale) {
				clearContentScaleStyles(contentEl);
				continue;
			}

			applyContentScaleStyles(contentEl, scale);
			activeContentEls.add(contentEl);
		}

		for (const contentEl of Array.from(this.target.containerEl.querySelectorAll<HTMLElement>(`.${CONTENT_SCALE_CLASS}`))) {
			if (!activeContentEls.has(contentEl)) {
				clearContentScaleStyles(contentEl);
			}
		}

		this.hasSyncedContentScales = true;
		this.hasScaledContent = hasScaledContent;
		this.contentScaleCanvas = canvas;
		this.hasContentScaleNodeMap = true;
	}

	private syncContentScalesIfNeeded(): void {
		const canvas = getNativeCanvas(this.target);

		if (canvas !== this.contentScaleCanvas || (Boolean(canvas?.nodes) && !this.hasContentScaleNodeMap)) {
			this.syncContentScales(canvas);
			return;
		}

		if (this.hasSyncedContentScales && !this.hasScaledContent) {
			return;
		}

		this.syncContentScales(canvas);
	}

	private clearContentScales(): void {
		for (const contentEl of Array.from(this.target.containerEl.querySelectorAll<HTMLElement>(`.${CONTENT_SCALE_CLASS}`))) {
			clearContentScaleStyles(contentEl);
		}

		this.hasSyncedContentScales = true;
		this.hasScaledContent = false;
		this.contentScaleCanvas = null;
		this.hasContentScaleNodeMap = false;
	}

	private syncAspectRatioResizePatch(canvas: NativeCanvasInstance): void {
		const resizePrototypes = new Set(getNativeCanvasNodeResizePrototypes(canvas));

		for (const [resizePrototype, releaseResizePatch] of this.releaseResizePatches) {
			if (!resizePrototypes.has(resizePrototype)) {
				releaseResizePatch();
				this.releaseResizePatches.delete(resizePrototype);
			}
		}

		for (const resizePrototype of resizePrototypes) {
			if (!this.releaseResizePatches.has(resizePrototype)) {
				this.releaseResizePatches.set(resizePrototype, acquireAspectRatioResizePatch(resizePrototype));
			}
		}
	}

	private releaseAspectRatioResizePatch(): void {
		for (const releaseResizePatch of this.releaseResizePatches.values()) {
			releaseResizePatch();
		}

		this.releaseResizePatches.clear();
	}

	private readonly handleButtonPointerDown = (event: PointerEvent): void => {
		event.preventDefault();
		event.stopPropagation();
	};

	private handleScaleButtonClick(event: MouseEvent, direction: ScaleDirection): void {
		event.preventDefault();
		event.stopPropagation();

		const canvas = getNativeCanvas(this.target);

		if (!canvas) {
			this.removeControls();
			return;
		}

		const scale = direction === "grow" ? CANVAS_ELEMENT_SCALE_STEP : 1 / CANVAS_ELEMENT_SCALE_STEP;

		if (!scaleSelectedCanvasNodes(canvas, scale)) {
			this.sync();
			return;
		}

		this.syncContentScales(canvas);
		canvas.requestSave?.(true);
		canvas.menu?.render?.(true);
		canvas.requestFrame?.();
		this.sync();
	}

	private addListener<T extends Event>(
		element: EventTarget,
		type: string,
		listener: (event: T) => void,
		options?: AddEventListenerOptions | boolean,
	): () => void {
		const eventListener = listener as EventListener;
		element.addEventListener(type, eventListener, options);
		return () => element.removeEventListener(type, eventListener, options);
	}
}

function acquireAspectRatioResizePatch(resizePrototype: NativeCanvasNodeResizePrototype): () => void {
	const original = resizePrototype.onResizePointerdown;
	const hadOwnResizePointerdown = Object.prototype.hasOwnProperty.call(resizePrototype, "onResizePointerdown");

	if (typeof original !== "function") {
		return noop;
	}

	const existingPatch = aspectRatioResizePatches.get(resizePrototype);

	if (existingPatch) {
		existingPatch.refCount++;
		return () => releaseAspectRatioResizePatch(resizePrototype);
	}

	const patch: AspectRatioResizePatch = {
		original,
		patched: createAspectRatioResizePointerdown(original),
		hadOwnResizePointerdown,
		refCount: 1,
	};

	resizePrototype.onResizePointerdown = patch.patched;
	aspectRatioResizePatches.set(resizePrototype, patch);
	return () => releaseAspectRatioResizePatch(resizePrototype);
}

function releaseAspectRatioResizePatch(resizePrototype: NativeCanvasNodeResizePrototype): void {
	const patch = aspectRatioResizePatches.get(resizePrototype);

	if (!patch) {
		return;
	}

	patch.refCount--;

	if (patch.refCount > 0) {
		return;
	}

	if (resizePrototype.onResizePointerdown === patch.patched) {
		if (patch.hadOwnResizePointerdown) {
			resizePrototype.onResizePointerdown = patch.original;
		} else {
			delete resizePrototype.onResizePointerdown;
		}
	}

	aspectRatioResizePatches.delete(resizePrototype);
}

function createAspectRatioResizePointerdown(original: NativeCanvasResizePointerdown): NativeCanvasResizePointerdown {
	return function patchedResizePointerdown(this: NativeCanvasNode, event: PointerEvent, resizeHandle: string): void {
		if (!shouldUseShiftAspectRatioResize(this, event)) {
			original.call(this, event, resizeHandle);
			return;
		}

		const previousAspectRatio = this.aspectRatio;
		const nextAspectRatio = getNodeAspectRatio(this);

		if (!isPositiveFiniteNumber(nextAspectRatio)) {
			original.call(this, event, resizeHandle);
			return;
		}

		this.aspectRatio = nextAspectRatio;

		const restoreAspectRatio = createAspectRatioRestore(this, previousAspectRatio, nextAspectRatio);

		try {
			original.call(this, event, resizeHandle);
		} catch (error) {
			restoreAspectRatio();
			throw error;
		}

		if (event.defaultPrevented) {
			addTemporaryAspectRatioRestoreListeners(event, restoreAspectRatio);
			return;
		}

		restoreAspectRatio();
	};
}

function shouldUseShiftAspectRatioResize(node: NativeCanvasNode, event: PointerEvent): boolean {
	return event.shiftKey
		&& event.isPrimary
		&& event.button === 0
		&& !isPositiveFiniteNumber(node.aspectRatio)
		&& isPositiveFiniteNumber(node.width)
		&& isPositiveFiniteNumber(node.height);
}

function getNodeAspectRatio(node: NativeCanvasNode): number {
	return node.width / node.height;
}

function createAspectRatioRestore(node: NativeCanvasNode, previousAspectRatio: number | undefined, temporaryAspectRatio: number): () => void {
	let didRestore = false;

	return () => {
		if (didRestore) {
			return;
		}

		didRestore = true;

		if (Math.abs((node.aspectRatio ?? 0) - temporaryAspectRatio) < ASPECT_RATIO_EPSILON) {
			node.aspectRatio = previousAspectRatio;
		}
	};
}

function addTemporaryAspectRatioRestoreListeners(event: PointerEvent, restoreAspectRatio: () => void): void {
	const eventWindow = getPointerEventWindow(event);
	let disposers: Array<() => void> = [];
	const scheduleRestore = (): void => {
		for (const dispose of disposers.splice(0)) {
			dispose();
		}

		eventWindow.setTimeout(restoreAspectRatio, 0);
	};

	disposers = [
		addTemporaryListener(eventWindow, "pointerup", scheduleRestore, true),
		addTemporaryListener(eventWindow, "pointercancel", scheduleRestore, true),
		addTemporaryListener(eventWindow, "blur", scheduleRestore, true),
	];
}

function addTemporaryListener<T extends Event>(
	element: EventTarget,
	type: string,
	listener: (event: T) => void,
	options?: AddEventListenerOptions | boolean,
): () => void {
	const eventListener = listener as EventListener;
	element.addEventListener(type, eventListener, options);
	return () => element.removeEventListener(type, eventListener, options);
}

function getPointerEventWindow(event: PointerEvent): Window {
	return (event as PointerEvent & {win?: Window}).win ?? event.view ?? window;
}

function getNativeCanvasNodeResizePrototypes(canvas: NativeCanvasInstance): NativeCanvasNodeResizePrototype[] {
	const resizePrototypes = new Set<NativeCanvasNodeResizePrototype>();

	for (const node of canvas.nodes?.values() ?? []) {
		for (const resizePrototype of getNodeResizePointerdownPrototypes(node)) {
			resizePrototypes.add(resizePrototype);
		}
	}

	return Array.from(resizePrototypes);
}

function getNodeResizePointerdownPrototypes(node: NativeCanvasNode): NativeCanvasNodeResizePrototype[] {
	const resizePrototypes: NativeCanvasNodeResizePrototype[] = [];
	let prototype: object | null = Object.getPrototypeOf(node) as object | null;

	while (prototype && prototype !== Object.prototype) {
		const resizePrototype = prototype as NativeCanvasNodeResizePrototype;

		if (Object.prototype.hasOwnProperty.call(resizePrototype, "onResizePointerdown")
			&& typeof resizePrototype.onResizePointerdown === "function") {
			resizePrototypes.push(resizePrototype);
		}

		prototype = Object.getPrototypeOf(prototype) as object | null;
	}

	return resizePrototypes;
}

function noop(): void {}

function scaleSelectedCanvasNodes(canvas: NativeCanvasInstance, scale: number): boolean {
	const nodes = getSelectedResizableNodes(canvas);
	const bounds = getCombinedBounds(nodes);

	if (!bounds) {
		return false;
	}

	const minDimension = getMinimumDimension(canvas);
	const origin = getBoundsCenter(bounds);
	let didScale = false;

	for (const node of nodes) {
		const currentCenter = {
			x: node.x + node.width / 2,
			y: node.y + node.height / 2,
		};
		const nextWidth = scaleDimension(node.width, scale, minDimension);
		const nextHeight = scaleDimension(node.height, scale, minDimension);
		const nextCenter = {
			x: origin.x + (currentCenter.x - origin.x) * scale,
			y: origin.y + (currentCenter.y - origin.y) * scale,
		};
		const nextRect = {
			x: roundCanvasValue(nextCenter.x - nextWidth / 2),
			y: roundCanvasValue(nextCenter.y - nextHeight / 2),
			width: nextWidth,
			height: nextHeight,
		};
		const nextContentScale = getNextNodeContentScale(node, scale);

		if (rectsMatch(node, nextRect) && nextContentScale === null) {
			continue;
		}

		if (applyNodeRect(node, nextRect, nextContentScale)) {
			didScale = true;
		}
	}

	return didScale;
}

function getSelectedResizableNodes(canvas: NativeCanvasInstance): NativeCanvasNode[] {
	const selection = canvas.selection;

	if (!selection) {
		return [];
	}

	const nodes: NativeCanvasNode[] = [];

	for (const selectedItem of selection) {
		const node = getCanvasNode(canvas, selectedItem);

		if (node) {
			nodes.push(node);
		}
	}

	return nodes;
}

function getCanvasNode(canvas: NativeCanvasInstance, selectedItem: unknown): NativeCanvasNode | null {
	if (isResizableCanvasNode(selectedItem)) {
		return selectedItem;
	}

	if (typeof selectedItem === "string") {
		const node = canvas.nodes?.get(selectedItem);
		return isResizableCanvasNode(node) ? node : null;
	}

	return null;
}

function isResizableCanvasNode(value: unknown): value is NativeCanvasNode {
	if (!value || typeof value !== "object") {
		return false;
	}

	const node = value as Partial<NativeCanvasNode>;
	return isPositiveFiniteNumber(node.width)
		&& isPositiveFiniteNumber(node.height)
		&& isFiniteNumber(node.x)
		&& isFiniteNumber(node.y)
		&& (typeof node.moveAndResize === "function" || (typeof node.getData === "function" && typeof node.setData === "function"));
}

function applyNodeRect(node: NativeCanvasNode, rect: NativeCanvasRect, contentScale: number | null): boolean {
	if (typeof node.getData === "function" && typeof node.setData === "function") {
		const nextData = {...node.getData(), ...rect};
		setNodeContentScale(nextData, contentScale);
		node.setData(nextData);
		node.render?.();
		applyNodeContentScale(node);
		return true;
	}

	if (typeof node.moveAndResize === "function") {
		node.moveAndResize(rect);
		node.render?.();
		applyNodeContentScale(node);
		return true;
	}

	return false;
}

function getNextNodeContentScale(node: NativeCanvasNode, scale: number): number | null {
	if (!shouldScaleNodeContent(node)) {
		return null;
	}

	return roundContentScale(getNodeContentScale(node) * scale);
}

function shouldScaleNodeContent(node: NativeCanvasNode): boolean {
	return node.getData?.().type === "text";
}

function getNodeContentScale(node: NativeCanvasNode): number {
	const value = node.getData?.()[CONTENT_SCALE_DATA_KEY];

	if (!isPositiveFiniteNumber(value)) {
		return DEFAULT_CONTENT_SCALE;
	}

	return Math.min(MAX_CONTENT_SCALE, Math.max(MIN_CONTENT_SCALE, value));
}

function setNodeContentScale(data: NativeCanvasNodeData, scale: number | null): void {
	if (scale === null || isDefaultContentScale(scale)) {
		delete data.drawInCanvasScale;
		return;
	}

	data.drawInCanvasScale = scale;
}

function applyNodeContentScale(node: NativeCanvasNode): void {
	const contentEl = getNodeContentEl(node);

	if (!contentEl) {
		return;
	}

	const scale = getNodeContentScale(node);

	if (isDefaultContentScale(scale)) {
		clearContentScaleStyles(contentEl);
		return;
	}

	applyContentScaleStyles(contentEl, scale);
}

function getNodeContentEl(node: NativeCanvasNode): HTMLElement | null {
	return node.nodeEl?.querySelector<HTMLElement>(".canvas-node-content") ?? null;
}

function applyContentScaleStyles(contentEl: HTMLElement, scale: number): void {
	contentEl.classList.add(CONTENT_SCALE_CLASS);
	contentEl.setCssStyles({
		transform: `scale(${scale})`,
		transformOrigin: "top left",
		width: `${100 / scale}%`,
		height: `${100 / scale}%`,
		flex: "0 0 auto",
	});
}

function clearContentScaleStyles(contentEl: HTMLElement): void {
	contentEl.classList.remove(CONTENT_SCALE_CLASS);
	contentEl.setCssStyles({
		transform: "",
		transformOrigin: "",
		width: "",
		height: "",
		flex: "",
	});
}

function isDefaultContentScale(scale: number): boolean {
	return Math.abs(scale - DEFAULT_CONTENT_SCALE) < CONTENT_SCALE_EPSILON;
}

function roundContentScale(value: number): number {
	const clampedValue = Math.min(MAX_CONTENT_SCALE, Math.max(MIN_CONTENT_SCALE, value));
	return Math.round(clampedValue * 1000) / 1000;
}

function getCombinedBounds(nodes: readonly NativeCanvasNode[]): NativeCanvasBounds | null {
	let combinedBounds: NativeCanvasBounds | null = null;

	for (const node of nodes) {
		const bounds = getNodeBounds(node);
		combinedBounds = combinedBounds ? mergeBounds(combinedBounds, bounds) : bounds;
	}

	return combinedBounds;
}

function getNodeBounds(node: NativeCanvasNode): NativeCanvasBounds {
	const bounds = node.getBBox?.();

	if (bounds && isValidBounds(bounds)) {
		return bounds;
	}

	return {
		minX: node.x,
		minY: node.y,
		maxX: node.x + node.width,
		maxY: node.y + node.height,
	};
}

function mergeBounds(a: NativeCanvasBounds, b: NativeCanvasBounds): NativeCanvasBounds {
	return {
		minX: Math.min(a.minX, b.minX),
		minY: Math.min(a.minY, b.minY),
		maxX: Math.max(a.maxX, b.maxX),
		maxY: Math.max(a.maxY, b.maxY),
	};
}

function getBoundsCenter(bounds: NativeCanvasBounds): {x: number; y: number} {
	return {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
	};
}

function getMinimumDimension(canvas: NativeCanvasInstance): number {
	const configuredMinimum = canvas.config?.minContainerDimension;
	return isPositiveFiniteNumber(configuredMinimum) ? configuredMinimum : TINY_CANVAS_MIN_DIMENSION;
}

function scaleDimension(value: number, scale: number, minDimension: number): number {
	const scaledValue = value * scale;
	const roundedValue = scale < 1 ? Math.floor(scaledValue) : Math.ceil(scaledValue);
	return Math.max(minDimension, roundedValue);
}

function rectsMatch(node: NativeCanvasNode, rect: NativeCanvasRect): boolean {
	return node.x === rect.x
		&& node.y === rect.y
		&& node.width === rect.width
		&& node.height === rect.height;
}

function findNativeMenuInsertionAnchor(menuEl: HTMLElement): HTMLButtonElement | null {
	return menuEl.querySelector<HTMLButtonElement>(`button.clickable-icon:not(.${SCALE_BUTTON_CLASS})`);
}

function getNativeCanvas(target: CanvasTarget): NativeCanvasInstance | null {
	return ((target.view as CanvasViewWithCanvas).canvas ?? null);
}

function isValidBounds(bounds: NativeCanvasBounds): boolean {
	return isFiniteNumber(bounds.minX)
		&& isFiniteNumber(bounds.minY)
		&& isFiniteNumber(bounds.maxX)
		&& isFiniteNumber(bounds.maxY)
		&& bounds.maxX >= bounds.minX
		&& bounds.maxY >= bounds.minY;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
	return isFiniteNumber(value) && value > 0;
}

function roundCanvasValue(value: number): number {
	return Math.round(value);
}