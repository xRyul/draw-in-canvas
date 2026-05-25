import {setIcon} from "obsidian";
import type {CanvasTarget} from "./canvas-target";
import {
	NativeCanvasContentScaleSync,
	applyNodeContentScale,
	getNextNodeContentScale,
	setNodeContentScale,
	shouldScaleNodeContent,
	type CanvasContentScaleNode,
	type CanvasContentScaleNodeData,
} from "./canvas-content-scale";
import {
	getLayerActionAvailability,
	hasLayerOrderChanged,
	orderItemsByIds,
	reorderIdsByLayerAction,
	type LayerAction,
	type LayerActionAvailability,
} from "./layering";

// Obsidian's Canvas API is internal, so keep native canvas element menu patches isolated here.

const CANVAS_ELEMENT_SCALE_STEP = 1.25;
const TINY_CANVAS_MIN_DIMENSION = 1;
const SCALE_BUTTON_CLASS = "draw-in-canvas-scale-button";
const SCALE_BUTTON_GROW_CLASS = "draw-in-canvas-scale-grow-button";
const SCALE_BUTTON_SHRINK_CLASS = "draw-in-canvas-scale-shrink-button";
const NATIVE_LAYER_MENU_CLASS = "draw-in-canvas-native-layer-menu";
const LAYER_MENU_CLASS = "draw-in-canvas-layer-menu";
const LAYER_MENU_BUTTON_CLASS = "draw-in-canvas-layer-menu-button";
const LAYER_SUBMENU_BUTTON_CLASS = "draw-in-canvas-layer-submenu-button";
const NATIVE_CONTROL_SELECTOR = `.${SCALE_BUTTON_CLASS}, .${NATIVE_LAYER_MENU_CLASS}`;
const NATIVE_LAYER_ACTIONS = [
	"send-to-back",
	"send-backward",
	"bring-forward",
	"bring-to-front",
] as const satisfies readonly LayerAction[];
const NATIVE_LAYER_BUTTON_CONFIGS: Record<LayerAction, {label: string; icon: string}> = {
	"send-to-back": {label: "Send selected canvas item to back", icon: "arrow-down-to-line"},
	"send-backward": {label: "Send selected canvas item backward", icon: "arrow-down"},
	"bring-forward": {label: "Bring selected canvas item forward", icon: "arrow-up"},
	"bring-to-front": {label: "Bring selected canvas item to front", icon: "arrow-up-to-line"},
};
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

interface NativeCanvasNodeData extends CanvasContentScaleNodeData, Partial<NativeCanvasRect> {}

interface NativeCanvasNodeResizePrototype {
	onResizePointerdown?: NativeCanvasResizePointerdown;
}

interface AspectRatioResizePatch {
	original: NativeCanvasResizePointerdown;
	patched: NativeCanvasResizePointerdown;
	hadOwnResizePointerdown: boolean;
	refCount: number;
}

interface NativeCanvasNode extends NativeCanvasRect, CanvasContentScaleNode {
	aspectRatio?: number;
	moveAndResize?: (rect: NativeCanvasRect) => void;
	setData?: (data: NativeCanvasNodeData) => void;
	getData?: () => NativeCanvasNodeData;
	getBBox?: () => NativeCanvasBounds;
	render?: () => void;
	zIndex?: number;
	renderZIndex?: () => void;
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
	zIndexCounter?: number;
}

type CanvasViewWithCanvas = CanvasTarget["view"] & {
	canvas?: NativeCanvasInstance | null;
};

type ScaleDirection = "grow" | "shrink";

interface ScaleSelectedCanvasNodesResult {
	didScale: boolean;
	contentScaleNodes: NativeCanvasNode[];
}

const aspectRatioResizePatches = new WeakMap<NativeCanvasNodeResizePrototype, AspectRatioResizePatch>();

export class NativeCanvasElementScaleControls {
	private enabled = false;
	private readonly buttonEls: HTMLButtonElement[] = [];
	private layerMenuEl: HTMLElement | null = null;
	private readonly buttonDisposers: Array<() => void> = [];
	private readonly releaseResizePatches = new Map<NativeCanvasNodeResizePrototype, () => void>();
	private readonly contentScaleSync: NativeCanvasContentScaleSync;
	private readonly target: CanvasTarget;

	constructor(target: CanvasTarget) {
		this.target = target;
		this.contentScaleSync = new NativeCanvasContentScaleSync(() => this.target.containerEl);
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;

		if (!enabled) {
			this.removeControls();
			this.releaseAspectRatioResizePatch();
			this.contentScaleSync.syncForCanvas(getNativeCanvas(this.target));
			return;
		}

		this.sync();
	}

	syncForCanvasDomChange(): void {
		if (this.enabled) {
			this.sync();
			return;
		}

		this.contentScaleSync.syncForCanvas(getNativeCanvas(this.target));
	}

	sync(options: {skipContentScaleSync?: boolean} = {}): void {
		const canvas = getNativeCanvas(this.target);

		if (!canvas) {
			this.removeControls();
			this.contentScaleSync.clear();
			this.releaseAspectRatioResizePatch();
			return;
		}

		if (!options.skipContentScaleSync) {
			this.contentScaleSync.syncForCanvas(canvas);
		}

		if (!this.enabled) {
			this.removeControls();
			this.releaseAspectRatioResizePatch();
			return;
		}

		this.syncAspectRatioResizePatch(canvas);

		const menuEl = this.findNativeMenuEl();

		if (!menuEl || getSelectedCanvasNodes(canvas).length === 0) {
			this.removeControls();
			return;
		}

		this.removeStaleControls(menuEl);

		if (this.areControlsMountedIn(menuEl)) {
			this.syncLayerMenuButtonStates(canvas);
			return;
		}

		this.removeControls();

		const growButtonEl = this.createScaleButton("grow");
		const shrinkButtonEl = this.createScaleButton("shrink");
		const layerMenuEl = this.createLayerMenuEl(canvas);
		this.buttonEls.push(growButtonEl, shrinkButtonEl);
		this.layerMenuEl = layerMenuEl;
		this.insertControls(menuEl, growButtonEl, shrinkButtonEl, layerMenuEl);
	}

	dispose(): void {
		this.enabled = false;
		this.removeControls();
		this.releaseAspectRatioResizePatch();
		this.contentScaleSync.clear();
	}

	getOwnedElements(): Element[] {
		return [
			...this.buttonEls.filter((buttonEl) => buttonEl.isConnected),
			...(this.layerMenuEl?.isConnected ? [this.layerMenuEl] : []),
		];
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

	private createLayerMenuEl(canvas: NativeCanvasInstance): HTMLElement {
		const wrapperEl = document.createElement("div");
		wrapperEl.classList.add(LAYER_MENU_CLASS, NATIVE_LAYER_MENU_CLASS);

		const buttonEl = document.createElement("button");
		buttonEl.type = "button";
		buttonEl.classList.add("clickable-icon", LAYER_MENU_BUTTON_CLASS);
		buttonEl.setAttribute("aria-label", "Layer selected canvas item");
		buttonEl.setAttribute("aria-haspopup", "menu");
		buttonEl.setAttribute("aria-expanded", "false");
		buttonEl.setAttribute("data-tooltip-position", "top");
		setIcon(buttonEl, "layers");

		const submenuEl = document.createElement("div");
		submenuEl.classList.add("canvas-menu", "draw-in-canvas-layer-submenu");
		submenuEl.setAttribute("role", "menu");
		const layerActionAvailability = getCanvasLayerActionAvailability(canvas);
		submenuEl.append(...NATIVE_LAYER_ACTIONS.map((action) => this.createLayerActionButton(layerActionAvailability, action)));

		wrapperEl.append(buttonEl, submenuEl);
		this.buttonDisposers.push(
			this.addListener(buttonEl, "pointerdown", this.handleButtonPointerDown),
			this.addListener(buttonEl, "click", (event: MouseEvent) => this.handleLayerMenuButtonClick(event, wrapperEl, buttonEl)),
		);

		return wrapperEl;
	}

	private createLayerActionButton(layerActionAvailability: LayerActionAvailability, action: LayerAction): HTMLButtonElement {
		const buttonConfig = NATIVE_LAYER_BUTTON_CONFIGS[action];
		const buttonEl = document.createElement("button");
		buttonEl.type = "button";
		buttonEl.classList.add("clickable-icon", LAYER_SUBMENU_BUTTON_CLASS);
		buttonEl.dataset.layerAction = action;
		buttonEl.disabled = !layerActionAvailability[action];
		buttonEl.setAttribute("aria-label", buttonConfig.label);
		buttonEl.setAttribute("data-tooltip-position", "top");
		buttonEl.setAttribute("role", "menuitem");
		setIcon(buttonEl, buttonConfig.icon);

		this.buttonDisposers.push(
			this.addListener(buttonEl, "pointerdown", this.handleButtonPointerDown),
			this.addListener(buttonEl, "click", (event: MouseEvent) => this.handleLayerActionButtonClick(event, action)),
		);

		return buttonEl;
	}

	private insertControls(menuEl: HTMLElement, ...controlEls: HTMLElement[]): void {
		const insertionAnchor = findNativeMenuInsertionAnchor(menuEl);

		for (const controlEl of controlEls) {
			menuEl.insertBefore(controlEl, insertionAnchor);
		}
	}

	private areControlsMountedIn(menuEl: HTMLElement): boolean {
		return this.buttonEls.length === 2
			&& this.buttonEls.every((buttonEl) => buttonEl.isConnected && buttonEl.parentElement === menuEl)
			&& Boolean(this.layerMenuEl?.isConnected && this.layerMenuEl.parentElement === menuEl);
	}

	private removeStaleControls(menuEl: HTMLElement): void {
		const knownControls = new Set<HTMLElement>([...this.buttonEls]);

		if (this.layerMenuEl) {
			knownControls.add(this.layerMenuEl);
		}

		const staleControls = Array.from(this.target.containerEl.querySelectorAll<HTMLElement>(NATIVE_CONTROL_SELECTOR));

		for (const controlEl of staleControls) {
			if (!knownControls.has(controlEl) || controlEl.parentElement !== menuEl) {
				controlEl.remove();
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

		this.layerMenuEl?.remove();
		this.layerMenuEl = null;
	}

	private findNativeMenuEl(): HTMLElement | null {
		return this.target.containerEl.querySelector<HTMLElement>(".canvas-menu:not(.draw-in-canvas-stroke-scale-menu):not(.draw-in-canvas-layer-submenu)");
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

		const scaleResult = scaleSelectedCanvasNodes(canvas, scale);

		if (!scaleResult.didScale) {
			this.sync();
			return;
		}

		this.contentScaleSync.syncChangedNodes(canvas, scaleResult.contentScaleNodes);
		canvas.requestSave?.(true);
		canvas.menu?.render?.(true);
		canvas.requestFrame?.();
		this.sync({skipContentScaleSync: true});
	}

	private handleLayerMenuButtonClick(event: MouseEvent, wrapperEl: HTMLElement, buttonEl: HTMLButtonElement): void {
		event.preventDefault();
		event.stopPropagation();

		const isOpen = !wrapperEl.classList.contains("is-open");
		wrapperEl.classList.toggle("is-open", isOpen);
		buttonEl.setAttribute("aria-expanded", isOpen.toString());
	}

	private handleLayerActionButtonClick(event: MouseEvent, action: LayerAction): void {
		event.preventDefault();
		event.stopPropagation();

		const canvas = getNativeCanvas(this.target);

		if (!canvas) {
			this.removeControls();
			return;
		}

		if (!reorderSelectedCanvasNodes(canvas, action)) {
			this.sync();
			return;
		}

		canvas.requestSave?.(true);
		canvas.menu?.render?.(true);
		canvas.requestFrame?.();
		this.sync();
	}

	private syncLayerMenuButtonStates(canvas: NativeCanvasInstance): void {
		const layerActionAvailability = getCanvasLayerActionAvailability(canvas);
		for (const buttonEl of Array.from(this.layerMenuEl?.querySelectorAll<HTMLButtonElement>(`.${LAYER_SUBMENU_BUTTON_CLASS}`) ?? [])) {
			const action = toLayerAction(buttonEl.dataset.layerAction);

			if (action) {
				buttonEl.disabled = !layerActionAvailability[action];
			}
		}
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

function getCanvasLayerActionAvailability(canvas: NativeCanvasInstance): LayerActionAvailability {
	return getLayerActionAvailability(getCanvasNodeLayerIds(canvas), getSelectedCanvasNodeIds(canvas));
}

function reorderSelectedCanvasNodes(canvas: NativeCanvasInstance, action: LayerAction): boolean {
	const selectedNodeIds = getSelectedCanvasNodeIds(canvas);
	const beforeNodeIds = getCanvasNodeLayerIds(canvas);
	const afterNodeIds = reorderIdsByLayerAction(beforeNodeIds, selectedNodeIds, action);

	if (selectedNodeIds.length === 0 || !hasLayerOrderChanged(beforeNodeIds, selectedNodeIds, action)) {
		return false;
	}

	applyCanvasNodeLayerOrder(canvas, afterNodeIds);
	return true;
}

function applyCanvasNodeLayerOrder(canvas: NativeCanvasInstance, nodeIds: readonly string[]): void {
	const currentNodes = getCanvasNodesByLayer(canvas);
	const orderedNodes = orderItemsByIds(currentNodes, nodeIds);
	const zIndexes = currentNodes
		.map((node, index) => isFiniteNumber(node.zIndex) ? node.zIndex : index + 1)
		.sort((a, b) => a - b);

	for (let index = 0; index < orderedNodes.length; index++) {
		const node = orderedNodes[index];
		const zIndex = zIndexes[index] ?? index + 1;

		if (!node) {
			continue;
		}

		node.zIndex = zIndex;
		node.renderZIndex?.();
		node.render?.();
	}

	canvas.zIndexCounter = Math.max(canvas.zIndexCounter ?? 0, ...zIndexes);
}

function getCanvasNodeLayerIds(canvas: NativeCanvasInstance): string[] {
	return getCanvasNodesByLayer(canvas).map((node) => node.id).filter(isPresent);
}

function getSelectedCanvasNodeIds(canvas: NativeCanvasInstance): string[] {
	return getSelectedCanvasNodes(canvas).map((node) => node.id).filter(isPresent);
}

function getCanvasNodesByLayer(canvas: NativeCanvasInstance): NativeCanvasNode[] {
	return Array.from(canvas.nodes?.values() ?? [])
		.filter(isLayerableCanvasNode)
		.sort(compareCanvasNodeLayer);
}

function compareCanvasNodeLayer(a: NativeCanvasNode, b: NativeCanvasNode): number {
	return getCanvasNodeZIndex(a) - getCanvasNodeZIndex(b);
}

function getCanvasNodeZIndex(node: NativeCanvasNode): number {
	return isFiniteNumber(node.zIndex) ? node.zIndex : 0;
}

function scaleSelectedCanvasNodes(canvas: NativeCanvasInstance, scale: number): ScaleSelectedCanvasNodesResult {
	const nodes = getSelectedResizableNodes(canvas);
	const bounds = getCombinedBounds(nodes);

	if (!bounds) {
		return {didScale: false, contentScaleNodes: []};
	}

	const minDimension = getMinimumDimension(canvas);
	const origin = getBoundsCenter(bounds);
	const contentScaleNodes: NativeCanvasNode[] = [];
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

			if (shouldScaleNodeContent(node)) {
				contentScaleNodes.push(node);
			}
		}
	}

	return {didScale, contentScaleNodes};
}

function getSelectedResizableNodes(canvas: NativeCanvasInstance): NativeCanvasNode[] {
	return getSelectedCanvasNodes(canvas).filter(isResizableCanvasNode);
}

function getSelectedCanvasNodes(canvas: NativeCanvasInstance): NativeCanvasNode[] {
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
	if (isLayerableCanvasNode(selectedItem)) {
		const node = canvas.nodes?.get(selectedItem.id);
		return isLayerableCanvasNode(node) ? node : null;
	}

	if (typeof selectedItem === "string") {
		const node = canvas.nodes?.get(selectedItem);
		return isLayerableCanvasNode(node) ? node : null;
	}

	return null;
}

function isLayerableCanvasNode(value: unknown): value is NativeCanvasNode & {id: string} {
	if (!value || typeof value !== "object") {
		return false;
	}

	const node = value as Partial<NativeCanvasNode>;
	return typeof node.id === "string" && node.id.length > 0;
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
	return menuEl.querySelector<HTMLButtonElement>(
		`button.clickable-icon:not(.${SCALE_BUTTON_CLASS}):not(.${LAYER_MENU_BUTTON_CLASS}):not(.${LAYER_SUBMENU_BUTTON_CLASS})`,
	);
}

function getNativeCanvas(target: CanvasTarget): NativeCanvasInstance | null {
	return ((target.view as CanvasViewWithCanvas).canvas ?? null);
}

function toLayerAction(value: string | undefined): LayerAction | null {
	return value === "bring-forward" || value === "bring-to-front" || value === "send-backward" || value === "send-to-back"
		? value
		: null;
}

function isPresent<T>(value: T | undefined): value is T {
	return value !== undefined;
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