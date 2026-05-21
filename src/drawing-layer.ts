import {App, Notice, setIcon} from "obsidian";
import {loadCanvasDrawingData, saveCanvasDrawingData} from "./canvas-file";
import {CanvasTarget} from "./canvas-target";
import {DrawInCanvasSettings, STROKE_WIDTH_MAX, STROKE_WIDTH_MIN, STROKE_WIDTH_STEP, normalizeStrokeWidth} from "./settings";
import {
	CanvasDrawingData,
	CanvasStroke,
	StrokePoint,
	createEmptyDrawingData,
	createStrokeId,
	pointsToSvgPath,
	roundCoordinate,
} from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_POINT_DISTANCE = 1;
const DRAG_MOVE_THRESHOLD = 1;
const HIT_TARGET_PADDING = 10;
const RESIZE_HANDLE_SIZE = 10;
const RESIZE_HANDLE_HIT_PADDING = 6;
const MIN_RESIZE_SCALE = 0.05;
const RESIZE_SCALE_EPSILON = 0.001;
const SAVE_DEBOUNCE_MS = 300;
const TOOLBAR_LONG_PRESS_MS = 450;
const HANDWRITTEN_EDGE_FOLLOW = 0.5;
const HANDWRITTEN_TAPER_LENGTH_MULTIPLIER = 2.5;
const HANDWRITTEN_TAPER_MIN_LENGTH = 6;
const PRESET_STROKE_COLORS = [
	{name: "Red", value: "#ef4444"},
	{name: "Orange", value: "#f97316"},
	{name: "Yellow", value: "#eab308"},
	{name: "Green", value: "#22c55e"},
	{name: "Teal", value: "#14b8a6"},
	{name: "Blue", value: "#3b82f6"},
	{name: "Purple", value: "#8b5cf6"},
	{name: "Pink", value: "#ec4899"},
	{name: "Slate", value: "#64748b"},
	{name: "Black", value: "#111827"},
	{name: "White", value: "#ffffff"},
	{name: "Accent", value: "var(--interactive-accent)"},
] as const;
const STALE_ELEMENT_SELECTOR = ".draw-in-canvas-control-group, .draw-in-canvas-render-layer, .draw-in-canvas-capture-layer, .draw-in-canvas-color-palette, .draw-in-canvas-stroke-width-preview";
const STALE_ELEMENT_CLASS = "draw-in-canvas-stale";
const COLOR_PALETTE_OPEN_BODY_CLASS = "draw-in-canvas-color-palette-open";

interface StrokeBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

type ResizeHandle = "nw" | "ne" | "se" | "sw";

type DrawingHistoryAction =
	| {type: "add-stroke"; stroke: CanvasStroke}
	| {type: "clear-strokes"; strokes: CanvasStroke[]}
	| {type: "delete-strokes"; strokes: CanvasStroke[]; indices: number[]}
	| {type: "move-stroke"; strokeId: string; delta: StrokePoint}
	| {type: "move-strokes"; strokeIds: string[]; delta: StrokePoint}
	| {type: "resize-strokes"; strokeIds: string[]; origin: StrokePoint; scale: number};

interface StrokeDragState {
	pointerId: number;
	strokeIds: string[];
	startPoint: StrokePoint;
	currentDelta: StrokePoint;
	strokeGroupEls: SVGGElement[];
	hasMoved: boolean;
}

interface StrokeResizeState {
	pointerId: number;
	strokeIds: string[];
	handle: ResizeHandle;
	origin: StrokePoint;
	referencePoint: StrokePoint;
	referenceDistance: number;
	currentScale: number;
	strokeGroupEls: SVGGElement[];
	hasMoved: boolean;
}

interface NativeSelectionDragState {
	pointerId: number;
	startPoint: StrokePoint;
	currentPoint: StrokePoint;
	initialSelectedStrokeIds: Set<string>;
	isAdditive: boolean;
	hasMoved: boolean;
}

interface SelectionBounds {
	bounds: StrokeBounds;
	padding: number;
}

interface ToolbarPressState {
	pointerId: number;
	timeoutId: number;
	didOpenPalette: boolean;
}

interface StrokeWidthPreviewState {
	pointerId: number;
	sliderEl: HTMLInputElement;
	x: number;
	y: number;
}

export function hideAllDrawInCanvasElements(root: ParentNode): void {
	const elements = Array.from(root.querySelectorAll<Element>(STALE_ELEMENT_SELECTOR));

	for (const element of elements) {
		element.classList.add(STALE_ELEMENT_CLASS);
	}
}

function hideStaleDrawInCanvasElements(root: ParentNode, ownedElements: ReadonlySet<Element>): void {
	const elements = Array.from(root.querySelectorAll<Element>(STALE_ELEMENT_SELECTOR));

	for (const element of elements) {
		element.classList.toggle(STALE_ELEMENT_CLASS, !ownedElements.has(element));
	}
}

export class DrawingLayer {
	private readonly app: App;
	private readonly target: CanvasTarget;
	private readonly requestToggleDrawingMode: () => void;
	private readonly requestSetStrokeColor: (color: string) => void;
	private readonly requestSetStrokeWidth: (width: number) => void;
	private settings: DrawInCanvasSettings;
	private drawingData: CanvasDrawingData = createEmptyDrawingData();
	private readonly strokeById = new Map<string, CanvasStroke>();
	private readonly strokeGroupById = new Map<string, SVGGElement>();
	private readonly strokeBoundsById = new Map<string, StrokeBounds>();
	private captureEl: HTMLDivElement | null = null;
	private svgEl: SVGSVGElement | null = null;
	private strokeInteractionEl: HTMLElement | null = null;
	private toolbarGroupEl: HTMLElement | null = null;
	private toolbarButtonEl: HTMLElement | null = null;
	private colorPaletteEl: HTMLElement | null = null;
	private toolbarPressState: ToolbarPressState | null = null;
	private strokeWidthPreviewEl: HTMLElement | null = null;
	private strokeWidthPreviewState: StrokeWidthPreviewState | null = null;
	private undoButtonEl: HTMLElement | null = null;
	private redoButtonEl: HTMLElement | null = null;
	private activeStroke: CanvasStroke | null = null;
	private activeStrokeGroupEl: SVGGElement | null = null;
	private activeStrokePathEl: SVGPathElement | null = null;
	private activeStrokePreviewFrameId: number | null = null;
	private readonly selectedStrokeIds = new Set<string>();
	private selectionBoxEl: SVGRectElement | null = null;
	private readonly selectionHandleEls: SVGRectElement[] = [];
	private dragState: StrokeDragState | null = null;
	private resizeState: StrokeResizeState | null = null;
	private nativeSelectionDragState: NativeSelectionDragState | null = null;
	private mutationObserver: MutationObserver | null = null;
	private domSyncFrameId: number | null = null;
	private saveTimeoutId: number | null = null;
	private hasPendingSave = false;
	private positionedEl: HTMLElement | null = null;
	private previousPosition = "";
	private suppressNextNativeUndoClick = false;
	private suppressNextNativeRedoClick = false;
	private isSpaceKeyPressed = false;
	private interactionCursor: string | null = null;
	private readonly captureDisposers: Array<() => void> = [];
	private readonly toolbarDisposers: Array<() => void> = [];
	private readonly colorPaletteDisposers: Array<() => void> = [];
	private readonly strokeWidthPreviewDisposers: Array<() => void> = [];
	private readonly renderDisposers: Array<() => void> = [];
	private readonly strokeInteractionDisposers: Array<() => void> = [];
	private readonly canvasHistoryButtonDisposers: Array<() => void> = [];
	private readonly undoStack: DrawingHistoryAction[] = [];
	private readonly redoStack: DrawingHistoryAction[] = [];

	constructor(
		app: App,
		target: CanvasTarget,
		settings: DrawInCanvasSettings,
		requestToggleDrawingMode: () => void,
		requestSetStrokeColor: (color: string) => void,
		requestSetStrokeWidth: (width: number) => void,
	) {
		this.app = app;
		this.target = target;
		this.settings = {...settings};
		this.requestToggleDrawingMode = requestToggleDrawingMode;
		this.requestSetStrokeColor = requestSetStrokeColor;
		this.requestSetStrokeWidth = requestSetStrokeWidth;
	}

	async start(): Promise<void> {
		this.drawingData = await loadCanvasDrawingData(this.app, this.target.file);
		this.rebuildStrokeIndex();
		this.mountRenderLayer();
		this.injectToolbarButton();
		this.observeCanvasDom();
	}

	async stop(): Promise<void> {
		this.disableDrawingMode();
		this.removeToolbarButton();
		this.removeCanvasHistoryButtonListeners();
		this.removeStrokeInteractionListeners();

		this.mutationObserver?.disconnect();
		this.mutationObserver = null;

		if (this.domSyncFrameId !== null) {
			window.cancelAnimationFrame(this.domSyncFrameId);
			this.domSyncFrameId = null;
		}

		this.cancelActiveStrokePreviewUpdate();

		for (const dispose of this.renderDisposers.splice(0)) {
			dispose();
		}

		this.clearNativeSelectionDrag();
		if (this.resizeState) {
			this.clearStrokeResizeTransform(this.resizeState);
			this.resizeState = null;
		}
		this.svgEl?.remove();
		this.svgEl = null;
		this.removeSelectionOverlay();
		this.strokeGroupById.clear();

		if (this.saveTimeoutId !== null) {
			window.clearTimeout(this.saveTimeoutId);
			this.saveTimeoutId = null;
		}

		await this.saveNow();
	}

	isDrawingEnabled(): boolean {
		return this.captureEl !== null;
	}

	enableDrawingMode(): void {
		if (this.captureEl) {
			return;
		}

		this.dragState = null;
		this.resizeState = null;
		this.clearNativeSelectionDrag();
		this.selectStrokes([]);
		this.mountRenderLayer();
		this.mountCaptureLayer();
		this.syncToolbarButton();
	}

	disableDrawingMode(): void {
		this.finishActiveStroke();

		for (const dispose of this.captureDisposers.splice(0)) {
			dispose();
		}

		this.captureEl?.remove();
		this.captureEl = null;

		if (this.positionedEl) {
			this.positionedEl.setCssStyles({position: this.previousPosition});
			this.positionedEl = null;
			this.previousPosition = "";
		}

		this.syncToolbarButton();
	}

	setSettings(settings: DrawInCanvasSettings): void {
		const shouldRerenderStrokes = settings.beautifulStrokes !== this.settings.beautifulStrokes;

		this.settings = {...settings};
		this.syncToolbarButton();
		this.syncColorPaletteSelection();

		if (shouldRerenderStrokes) {
			if (this.activeStroke) {
				this.updateActiveStrokePreview();
			} else {
				this.renderStrokes();
			}
		}
	}

	async clear(): Promise<void> {
		this.finishActiveStroke();

		if (this.drawingData.strokes.length === 0) {
			return;
		}

		this.pushHistory({
			type: "clear-strokes",
			strokes: cloneStrokes(this.drawingData.strokes),
		});
		this.drawingData = createEmptyDrawingData();
		this.rebuildStrokeIndex();
		this.selectedStrokeIds.clear();
		this.renderStrokes();
		this.hasPendingSave = true;
		await this.saveNow();
	}

	async undoLastStroke(): Promise<boolean> {
		this.finishActiveStroke();
		const action = this.undoStack.pop();

		if (!action) {
			return false;
		}

		this.applyHistoryAction(action, "undo");
		this.redoStack.push(cloneHistoryAction(action));
		this.hasPendingSave = true;
		this.syncCanvasUndoRedoButtons();
		await this.saveNow();
		return true;
	}

	async redoLastStroke(): Promise<boolean> {
		this.finishActiveStroke();
		const action = this.redoStack.pop();

		if (!action) {
			return false;
		}

		this.applyHistoryAction(action, "redo");
		this.undoStack.push(cloneHistoryAction(action));
		this.hasPendingSave = true;
		this.syncCanvasUndoRedoButtons();
		await this.saveNow();
		return true;
	}

	private mountCaptureLayer(): void {
		const captureParentEl = this.findCanvasWrapperEl();
		this.ensurePositioned(captureParentEl);

		const captureEl = document.createElement("div");
		captureEl.classList.add("draw-in-canvas-capture-layer");
		captureEl.tabIndex = 0;

		captureParentEl.appendChild(captureEl);
		this.captureEl = captureEl;
		this.hideStaleElements();

		this.captureDisposers.push(
			this.addListener(captureEl, "pointerdown", this.handlePointerDown),
			this.addListener(captureEl, "pointermove", this.handlePointerMove),
			this.addListener(captureEl, "pointerup", this.handlePointerUp),
			this.addListener(captureEl, "pointercancel", this.handlePointerUp),
			this.addListener(captureEl, "keydown", this.handleKeyDown),
		);

		window.requestAnimationFrame(() => captureEl.focus({preventScroll: true}));
	}

	private mountRenderLayer(): void {
		const worldEl = this.findCanvasWorldEl();
		let svgEl = this.svgEl;
		let shouldRender = false;

		if (!svgEl) {
			svgEl = document.createElementNS(SVG_NS, "svg");
			svgEl.classList.add("draw-in-canvas-render-layer");
			svgEl.setAttribute("aria-hidden", "true");
			svgEl.setAttribute("focusable", "false");
			this.svgEl = svgEl;
			shouldRender = true;
		}

		if (svgEl.parentElement !== worldEl || worldEl.lastElementChild !== svgEl) {
			worldEl.appendChild(svgEl);
		}

		if (shouldRender) {
			this.renderStrokes();
		}

		this.syncStrokeInteractionListeners();

		this.hideStaleElements();
	}

	private injectToolbarButton(): void {
		const controlsEl = this.target.containerEl.querySelector<HTMLElement>(".canvas-controls");

		if (!controlsEl) {
			return;
		}

		this.syncCanvasHistoryButtonListeners(controlsEl);

		if (this.toolbarGroupEl?.isConnected && this.toolbarGroupEl.parentElement === controlsEl) {
			this.syncToolbarButton();
			return;
		}

		this.removeToolbarButton();

		const groupEl = document.createElement("div");
		groupEl.classList.add("canvas-control-group", "mod-raised", "draw-in-canvas-control-group");

		const buttonEl = document.createElement("div");
		buttonEl.classList.add("canvas-control-item", "draw-in-canvas-control-item");
		buttonEl.setAttribute("aria-label", "Toggle drawing mode. Long press or right click for stroke colors");
		buttonEl.setAttribute("data-tooltip-position", "left");
		buttonEl.setAttribute("role", "button");
		buttonEl.setAttribute("aria-haspopup", "menu");
		buttonEl.setAttribute("aria-expanded", "false");
		buttonEl.tabIndex = 0;
		setIcon(buttonEl, "pencil");

		groupEl.appendChild(buttonEl);
		controlsEl.insertBefore(groupEl, getZoomControlGroup(controlsEl));

		this.toolbarGroupEl = groupEl;
		this.toolbarButtonEl = buttonEl;
		this.toolbarDisposers.push(
			this.addListener(buttonEl, "pointerdown", this.handleToolbarPointerDown),
			this.addListener(buttonEl, "pointerup", this.handleToolbarPointerUp),
			this.addListener(buttonEl, "pointercancel", this.handleToolbarPointerCancel),
			this.addListener(buttonEl, "keydown", this.handleToolbarKeyDown),
			this.addListener(buttonEl, "contextmenu", this.handleToolbarContextMenu),
		);
		this.syncToolbarButton();
		this.hideStaleElements();
	}

	private removeToolbarButton(): void {
		this.closeColorPalette();
		this.clearToolbarPressState();
		for (const dispose of this.toolbarDisposers.splice(0)) {
			dispose();
		}

		this.toolbarGroupEl?.remove();
		this.toolbarGroupEl = null;
		this.toolbarButtonEl = null;
	}

	private syncToolbarButton(): void {
		if (!this.toolbarButtonEl) {
			return;
		}

		const isEnabled = this.isDrawingEnabled();
		this.toolbarButtonEl.classList.toggle("is-active", isEnabled);
		this.toolbarButtonEl.setAttribute("aria-pressed", isEnabled.toString());
		this.toolbarButtonEl.setCssProps({"--draw-in-canvas-current-color": this.settings.strokeColor});
		this.toolbarButtonEl.setAttribute("aria-expanded", (this.colorPaletteEl?.isConnected ?? false).toString());
	}

	private openColorPalette(): void {
		if (!this.toolbarGroupEl || !this.toolbarButtonEl) {
			return;
		}

		if (!this.isDrawingEnabled()) {
			this.enableDrawingMode();
		}

		if (this.colorPaletteEl?.isConnected) {
			this.positionColorPalette();
			this.syncColorPaletteSelection();
			return;
		}

		this.closeColorPalette();

		const paletteEl = document.createElement("div");
		paletteEl.classList.add("draw-in-canvas-color-palette");
		paletteEl.setAttribute("role", "menu");

		const paletteLabelEl = document.createElement("span");
		paletteLabelEl.id = createStrokeId();
		paletteLabelEl.classList.add("draw-in-canvas-visually-hidden");
		paletteLabelEl.textContent = "Stroke color and size";
		paletteEl.setAttribute("aria-labelledby", paletteLabelEl.id);
		paletteEl.appendChild(paletteLabelEl);

		const swatchEls: HTMLButtonElement[] = [];

		for (const color of PRESET_STROKE_COLORS) {
			const swatchEl = document.createElement("button");
			swatchEl.type = "button";
			swatchEl.classList.add("draw-in-canvas-color-swatch");
			swatchEl.dataset.color = color.value;
			swatchEl.setAttribute("role", "menuitemradio");
			swatchEl.setAttribute("aria-label", `Use ${color.name.toLowerCase()} stroke color`);
			swatchEl.setCssProps({"--draw-in-canvas-swatch-color": color.value});
			swatchEl.setCssStyles({backgroundColor: color.value});

			this.colorPaletteDisposers.push(
				this.addListener(swatchEl, "pointerdown", this.handleColorSwatchPointerDown),
				this.addListener(swatchEl, "click", (event: MouseEvent) => {
					event.preventDefault();
					event.stopPropagation();
					this.setStrokeColor(color.value);
					this.closeColorPalette();
					this.toolbarButtonEl?.focus({preventScroll: true});
				}),
			);

			paletteEl.appendChild(swatchEl);
			swatchEls.push(swatchEl);
		}

		paletteEl.appendChild(this.createStrokeWidthControlEl());

		document.body.appendChild(paletteEl);
		this.colorPaletteEl = paletteEl;
		document.body.classList.add(COLOR_PALETTE_OPEN_BODY_CLASS);
		this.positionColorPalette();
		this.toolbarButtonEl.setAttribute("aria-expanded", "true");
		this.colorPaletteDisposers.push(
			this.addListener(document, "pointerdown", this.handleColorPaletteDocumentPointerDown, true),
			this.addListener(document, "keydown", this.handleColorPaletteDocumentKeyDown, true),
			this.addListener(window, "blur", this.handleColorPaletteWindowBlur),
		);
		this.syncColorPaletteSelection();

		const selectedSwatchEl = swatchEls.find((swatchEl) => colorsMatch(swatchEl.dataset.color ?? "", this.settings.strokeColor));
		window.requestAnimationFrame(() => (selectedSwatchEl ?? swatchEls[0])?.focus({preventScroll: true}));
	}

	private positionColorPalette(): void {
		if (!this.colorPaletteEl || !this.toolbarButtonEl) {
			return;
		}

		const buttonRect = this.toolbarButtonEl.getBoundingClientRect();
		const paletteRect = this.colorPaletteEl.getBoundingClientRect();
		const viewportMargin = 8;
		const gap = 8;
		const top = Math.max(
			viewportMargin,
			Math.min(buttonRect.top, window.innerHeight - paletteRect.height - viewportMargin),
		);
		const right = Math.max(viewportMargin, window.innerWidth - buttonRect.left + gap);

		this.colorPaletteEl.setCssStyles({
			top: `${top}px`,
			right: `${right}px`,
		});
	}

	private closeColorPalette(): void {
		this.closeStrokeWidthPreview();
		for (const dispose of this.colorPaletteDisposers.splice(0)) {
			dispose();
		}

		this.colorPaletteEl?.remove();
		this.colorPaletteEl = null;
		document.body.classList.remove(COLOR_PALETTE_OPEN_BODY_CLASS);
		this.toolbarButtonEl?.setAttribute("aria-expanded", "false");
	}

	private syncColorPaletteSelection(): void {
		const swatchEls = this.colorPaletteEl?.querySelectorAll<HTMLElement>(".draw-in-canvas-color-swatch") ?? [];

		for (const swatchEl of Array.from(swatchEls)) {
			const isSelected = colorsMatch(swatchEl.dataset.color ?? "", this.settings.strokeColor);
			swatchEl.classList.toggle("is-selected", isSelected);
			swatchEl.setAttribute("aria-checked", isSelected.toString());
		}

		const strokeWidth = normalizeStrokeWidth(this.settings.strokeWidth);
		const widthSliderEl = this.colorPaletteEl?.querySelector<HTMLInputElement>(".draw-in-canvas-stroke-width-slider");
		const widthValueEl = this.colorPaletteEl?.querySelector<HTMLElement>(".draw-in-canvas-stroke-width-value");

		if (widthSliderEl) {
			widthSliderEl.value = strokeWidth.toString();
		}

		if (widthValueEl) {
			widthValueEl.textContent = formatStrokeWidth(strokeWidth);
		}
	}

	private setStrokeColor(color: string): void {
		if (colorsMatch(color, this.settings.strokeColor)) {
			return;
		}

		this.settings = {...this.settings, strokeColor: color};
		this.requestSetStrokeColor(color);
		this.syncToolbarButton();
		this.syncColorPaletteSelection();
	}

	private createStrokeWidthControlEl(): HTMLElement {
		const controlEl = document.createElement("div");
		controlEl.classList.add("draw-in-canvas-stroke-width-control");

		const inputId = createStrokeId();
		const headerEl = document.createElement("div");
		headerEl.classList.add("draw-in-canvas-stroke-width-header");

		const labelEl = document.createElement("label");
		labelEl.htmlFor = inputId;
		labelEl.textContent = "Stroke size";

		const valueEl = document.createElement("span");
		valueEl.classList.add("draw-in-canvas-stroke-width-value");
		valueEl.textContent = formatStrokeWidth(normalizeStrokeWidth(this.settings.strokeWidth));

		headerEl.append(labelEl, valueEl);

		const sliderEl = document.createElement("input");
		sliderEl.id = inputId;
		sliderEl.classList.add("draw-in-canvas-stroke-width-slider");
		sliderEl.type = "range";
		sliderEl.min = STROKE_WIDTH_MIN.toString();
		sliderEl.max = STROKE_WIDTH_MAX.toString();
		sliderEl.step = STROKE_WIDTH_STEP.toString();
		sliderEl.value = normalizeStrokeWidth(this.settings.strokeWidth).toString();
		sliderEl.setAttribute("aria-label", "Stroke size");

		this.colorPaletteDisposers.push(
			this.addListener(sliderEl, "pointerdown", this.handleStrokeWidthSliderPointerDown),
			this.addListener(sliderEl, "keydown", this.handleStrokeWidthSliderKeyDown),
			this.addListener(sliderEl, "input", this.handleStrokeWidthSliderInput),
		);

		controlEl.append(headerEl, sliderEl);
		return controlEl;
	}

	private setStrokeWidth(width: number): void {
		const strokeWidth = normalizeStrokeWidth(width);

		if (strokeWidth === normalizeStrokeWidth(this.settings.strokeWidth)) {
			return;
		}

		this.settings = {...this.settings, strokeWidth};
		this.requestSetStrokeWidth(strokeWidth);
		this.syncColorPaletteSelection();
	}

	private openStrokeWidthPreview(event: PointerEvent, sliderEl: HTMLInputElement): void {
		this.closeStrokeWidthPreview();
		this.strokeWidthPreviewState = {
			pointerId: event.pointerId,
			sliderEl,
			x: event.clientX,
			y: event.clientY,
		};

		trySetPointerCapture(sliderEl, event.pointerId);
		this.strokeWidthPreviewDisposers.push(
			this.addListener(document, "pointermove", this.handleStrokeWidthPreviewPointerMove, true),
			this.addListener(document, "pointerup", this.handleStrokeWidthPreviewPointerUp, true),
			this.addListener(document, "pointercancel", this.handleStrokeWidthPreviewPointerUp, true),
			this.addListener(window, "blur", this.handleStrokeWidthPreviewWindowBlur),
		);

		this.positionStrokeWidthPreview(event.clientX, event.clientY);
		this.updateStrokeWidthPreview(Number(sliderEl.value));
	}

	private closeStrokeWidthPreview(): void {
		for (const dispose of this.strokeWidthPreviewDisposers.splice(0)) {
			dispose();
		}

		const state = this.strokeWidthPreviewState;

		if (state?.sliderEl.hasPointerCapture(state.pointerId)) {
			state.sliderEl.releasePointerCapture(state.pointerId);
		}

		this.strokeWidthPreviewEl?.remove();
		this.strokeWidthPreviewEl = null;
		this.strokeWidthPreviewState = null;
	}

	private positionStrokeWidthPreview(x: number, y: number): void {
		const previewEl = this.ensureStrokeWidthPreviewEl();
		const state = this.strokeWidthPreviewState;

		if (state) {
			state.x = x;
			state.y = y;
		}

		previewEl.setCssStyles({
			left: `${x + 18}px`,
			top: `${y + 18}px`,
		});
	}

	private updateStrokeWidthPreview(width: number): void {
		const state = this.strokeWidthPreviewState;

		if (!state) {
			return;
		}

		const strokeWidth = normalizeStrokeWidth(width);
		const previewEl = this.ensureStrokeWidthPreviewEl();
		const labelEl = previewEl.querySelector<HTMLElement>(".draw-in-canvas-stroke-width-preview-label");

		previewEl.setCssProps({
			"--draw-in-canvas-stroke-width-preview-size": `${Math.max(4, strokeWidth)}px`,
			"--draw-in-canvas-stroke-width-preview-color": this.settings.strokeColor,
		});

		if (labelEl) {
			labelEl.textContent = formatStrokeWidth(strokeWidth);
		}

		this.positionStrokeWidthPreview(state.x, state.y);
	}

	private ensureStrokeWidthPreviewEl(): HTMLElement {
		if (this.strokeWidthPreviewEl?.isConnected) {
			return this.strokeWidthPreviewEl;
		}

		const previewEl = document.createElement("div");
		previewEl.classList.add("draw-in-canvas-stroke-width-preview");
		previewEl.setAttribute("aria-hidden", "true");

		const dotEl = document.createElement("span");
		dotEl.classList.add("draw-in-canvas-stroke-width-preview-dot");

		const labelEl = document.createElement("span");
		labelEl.classList.add("draw-in-canvas-stroke-width-preview-label");

		previewEl.append(dotEl, labelEl);
		document.body.appendChild(previewEl);
		this.strokeWidthPreviewEl = previewEl;
		return previewEl;
	}

	private clearToolbarPressState(): void {
		const pressState = this.toolbarPressState;

		if (!pressState) {
			return;
		}

		window.clearTimeout(pressState.timeoutId);

		if (this.toolbarButtonEl?.hasPointerCapture(pressState.pointerId)) {
			this.toolbarButtonEl.releasePointerCapture(pressState.pointerId);
		}

		this.toolbarPressState = null;
	}

	private syncCanvasHistoryButtonListeners(controlsEl: HTMLElement): void {
		const undoButtonEl = findCanvasControlButton(controlsEl, "Undo");
		const redoButtonEl = findCanvasControlButton(controlsEl, "Redo");

		if (this.undoButtonEl === undoButtonEl && this.redoButtonEl === redoButtonEl) {
			this.syncCanvasUndoRedoButtons();
			return;
		}

		this.removeCanvasHistoryButtonListeners();
		this.undoButtonEl = undoButtonEl;
		this.redoButtonEl = redoButtonEl;

		if (undoButtonEl) {
			this.canvasHistoryButtonDisposers.push(
				this.addListener(undoButtonEl, "pointerdown", this.handleCanvasUndoPointerDown),
				this.addListener(undoButtonEl, "click", this.handleCanvasUndoClick),
				this.addListener(undoButtonEl, "keydown", this.handleCanvasUndoKeyDown),
			);
		}

		if (redoButtonEl) {
			this.canvasHistoryButtonDisposers.push(
				this.addListener(redoButtonEl, "pointerdown", this.handleCanvasRedoPointerDown),
				this.addListener(redoButtonEl, "click", this.handleCanvasRedoClick),
				this.addListener(redoButtonEl, "keydown", this.handleCanvasRedoKeyDown),
			);
		}

		this.syncCanvasUndoRedoButtons();
	}

	private removeCanvasHistoryButtonListeners(): void {
		for (const dispose of this.canvasHistoryButtonDisposers.splice(0)) {
			dispose();
		}

		this.undoButtonEl = null;
		this.suppressNextNativeUndoClick = false;
		this.suppressNextNativeRedoClick = false;
		this.redoButtonEl = null;
	}

	private syncCanvasUndoRedoButtons(): void {
		this.undoButtonEl?.classList.toggle("draw-in-canvas-can-undo", this.undoStack.length > 0);
		this.redoButtonEl?.classList.toggle("draw-in-canvas-can-redo", this.redoStack.length > 0);
	}

	private syncStrokeInteractionListeners(): void {
		const strokeInteractionEl = this.findCanvasWrapperEl();

		if (this.strokeInteractionEl === strokeInteractionEl) {
			return;
		}

		this.removeStrokeInteractionListeners();
		this.strokeInteractionEl = strokeInteractionEl;
		this.strokeInteractionDisposers.push(
			this.addListener(strokeInteractionEl, "pointerdown", this.handleStrokePointerDown, true),
			this.addListener(strokeInteractionEl, "pointermove", this.handleStrokePointerMove, true),
			this.addListener(strokeInteractionEl, "pointerup", this.handleStrokePointerUp, true),
			this.addListener(strokeInteractionEl, "pointercancel", this.handleStrokePointerUp, true),
			this.addListener(strokeInteractionEl, "pointerleave", this.handleStrokePointerLeave, true),
			this.addListener(document, "keydown", this.handleDocumentKeyDown, true),
			this.addListener(document, "keyup", this.handleDocumentKeyUp, true),
			this.addListener(window, "blur", this.handleWindowBlur),
		);
	}

	private removeStrokeInteractionListeners(): void {
		this.setInteractionCursor(null);
		for (const dispose of this.strokeInteractionDisposers.splice(0)) {
			dispose();
		}

		this.isSpaceKeyPressed = false;
		this.strokeInteractionEl = null;
	}

	private observeCanvasDom(): void {
		this.mutationObserver = new MutationObserver(() => this.scheduleCanvasDomSync());

		this.mutationObserver.observe(this.target.containerEl, {
			childList: true,
			subtree: true,
		});
	}

	private scheduleCanvasDomSync(): void {
		if (this.domSyncFrameId !== null) {
			return;
		}

		this.domSyncFrameId = window.requestAnimationFrame(() => {
			this.domSyncFrameId = null;
			this.mountRenderLayer();
			this.injectToolbarButton();
		});
	}

	private renderStrokes(): void {
		if (!this.svgEl) {
			return;
		}

		this.svgEl.replaceChildren();
		this.strokeGroupById.clear();
		this.selectionBoxEl = null;
		this.selectionHandleEls.length = 0;

		for (const stroke of this.drawingData.strokes) {
			this.svgEl.appendChild(this.createStrokeGroupEl(stroke));
		}

		this.renderSelectionBox();
	}

	private createStrokeGroupEl(stroke: CanvasStroke): SVGGElement {
		const groupEl = document.createElementNS(SVG_NS, "g");
		groupEl.classList.add("draw-in-canvas-stroke-wrapper");
		groupEl.classList.toggle("is-selected", this.selectedStrokeIds.has(stroke.id));
		groupEl.dataset.strokeId = stroke.id;

		groupEl.appendChild(this.createPathEl(stroke));
		groupEl.appendChild(this.createHitPathEl(stroke));
		this.strokeGroupById.set(stroke.id, groupEl);
		return groupEl;
	}

	private createPathEl(stroke: CanvasStroke): SVGPathElement {
		const pathEl = document.createElementNS(SVG_NS, "path");
		pathEl.classList.add("draw-in-canvas-stroke");
		this.updateVisibleStrokePathEl(pathEl, stroke);
		return pathEl;
	}

	private updateVisibleStrokePathEl(pathEl: SVGPathElement, stroke: CanvasStroke): void {
		pathEl.classList.toggle("mod-handwritten", this.settings.beautifulStrokes);
		pathEl.setAttribute("pointer-events", "none");

		if (this.settings.beautifulStrokes) {
			pathEl.setAttribute("d", getHandwrittenStrokeShapePath(stroke));
			pathEl.setAttribute("fill", stroke.color);
			pathEl.setAttribute("stroke", "none");
			pathEl.removeAttribute("stroke-width");
			pathEl.removeAttribute("stroke-linecap");
			pathEl.removeAttribute("stroke-linejoin");
			return;
		}

		pathEl.setAttribute("d", this.getStrokeCenterPath(stroke));
		pathEl.setAttribute("stroke", stroke.color);
		pathEl.setAttribute("stroke-width", stroke.width.toString());
		pathEl.setAttribute("fill", "none");
		pathEl.setAttribute("stroke-linecap", "round");
		pathEl.setAttribute("stroke-linejoin", "round");
	}


	private createHitPathEl(stroke: CanvasStroke): SVGPathElement {
		const pathEl = document.createElementNS(SVG_NS, "path");
		pathEl.classList.add("draw-in-canvas-stroke-hit");
		pathEl.setAttribute("d", this.getStrokeCenterPath(stroke));
		pathEl.setAttribute("stroke", "transparent");
		pathEl.setAttribute("stroke-width", Math.max(stroke.width + HIT_TARGET_PADDING, 12).toString());
		pathEl.setAttribute("fill", "none");
		pathEl.setAttribute("stroke-linecap", "round");
		pathEl.setAttribute("stroke-linejoin", "round");
		pathEl.setAttribute("pointer-events", "stroke");
		return pathEl;
	}


	private getStrokeCenterPath(stroke: CanvasStroke): string {
		return pointsToSvgPath(stroke.points, {smooth: this.settings.beautifulStrokes});
	}

	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || !this.captureEl) {
			return;
		}

		if (this.isSpaceKeyPressed) {
			return;
		}

		this.mountRenderLayer();

		const point = this.clientPointToCanvasPoint(event);

		if (!point || !this.svgEl) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		trySetPointerCapture(this.captureEl, event.pointerId);

		const stroke: CanvasStroke = {
			id: createStrokeId(),
			color: this.settings.strokeColor,
			width: this.settings.strokeWidth,
			points: [point],
			createdAt: Date.now(),
		};

		const strokeGroupEl = document.createElementNS(SVG_NS, "g");
		strokeGroupEl.classList.add("draw-in-canvas-active-stroke");
		strokeGroupEl.setAttribute("pointer-events", "none");
		const activeStrokePathEl = this.createPathEl(stroke);
		strokeGroupEl.appendChild(activeStrokePathEl);

		this.activeStroke = stroke;
		this.activeStrokeGroupEl = strokeGroupEl;
		this.activeStrokePathEl = activeStrokePathEl;
		this.addStroke(stroke);
		this.svgEl.appendChild(strokeGroupEl);
	};

	private readonly handlePointerMove = (event: PointerEvent): void => {
		if (!this.activeStroke || !this.activeStrokeGroupEl) {
			return;
		}

		const point = this.clientPointToCanvasPoint(event);

		if (!point) {
			return;
		}

		const previousPoint = this.activeStroke.points[this.activeStroke.points.length - 1];

		if (!previousPoint || distanceBetween(previousPoint, point) < MIN_POINT_DISTANCE) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.activeStroke.points.push(point);
		this.scheduleActiveStrokePreviewUpdate();
	};

	private readonly handlePointerUp = (event: PointerEvent): void => {
		if (!this.activeStroke) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		if (this.captureEl?.hasPointerCapture(event.pointerId)) {
			this.captureEl.releasePointerCapture(event.pointerId);
		}

		this.finishActiveStroke();
	};

	private scheduleActiveStrokePreviewUpdate(): void {
		if (this.activeStrokePreviewFrameId !== null) {
			return;
		}

		this.activeStrokePreviewFrameId = window.requestAnimationFrame(() => {
			this.activeStrokePreviewFrameId = null;
			this.updateActiveStrokePreview();
		});
	}

	private updateActiveStrokePreview(): void {
		if (!this.activeStroke || !this.activeStrokePathEl) {
			return;
		}

		this.updateVisibleStrokePathEl(this.activeStrokePathEl, this.activeStroke);
	}

	private cancelActiveStrokePreviewUpdate(): void {
		if (this.activeStrokePreviewFrameId === null) {
			return;
		}

		window.cancelAnimationFrame(this.activeStrokePreviewFrameId);
		this.activeStrokePreviewFrameId = null;
	}

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.requestToggleDrawingMode();
	};

	private readonly handleToolbarPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || !this.toolbarButtonEl) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.toolbarButtonEl.focus({preventScroll: true});
		this.clearToolbarPressState();
		trySetPointerCapture(this.toolbarButtonEl, event.pointerId);

		const pressState: ToolbarPressState = {
			pointerId: event.pointerId,
			timeoutId: window.setTimeout(() => {
				if (this.toolbarPressState !== pressState) {
					return;
				}

				pressState.didOpenPalette = true;
				this.openColorPalette();
			}, TOOLBAR_LONG_PRESS_MS),
			didOpenPalette: false,
		};

		this.toolbarPressState = pressState;
	};

	private readonly handleToolbarPointerUp = (event: PointerEvent): void => {
		const pressState = this.toolbarPressState;

		if (!pressState || pressState.pointerId !== event.pointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const shouldToggleDrawingMode = !pressState.didOpenPalette;
		this.clearToolbarPressState();

		if (shouldToggleDrawingMode) {
			this.closeColorPalette();
			this.requestToggleDrawingMode();
		}
	};

	private readonly handleToolbarPointerCancel = (event: PointerEvent): void => {
		const pressState = this.toolbarPressState;

		if (!pressState || pressState.pointerId !== event.pointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.clearToolbarPressState();
	};

	private readonly handleToolbarContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		this.clearToolbarPressState();
		this.toolbarButtonEl?.focus({preventScroll: true});
		this.openColorPalette();
	};

	private readonly handleToolbarKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			event.stopPropagation();
			this.openColorPalette();
			return;
		}

		if (!isActivationKey(event)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.closeColorPalette();
		this.requestToggleDrawingMode();
	};

	private readonly handleColorSwatchPointerDown = (event: PointerEvent): void => {
		event.preventDefault();
		event.stopPropagation();
	};

	private readonly handleStrokeWidthSliderPointerDown = (event: PointerEvent): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		event.currentTarget.focus({preventScroll: true});
		this.openStrokeWidthPreview(event, event.currentTarget);
	};

	private readonly handleStrokeWidthSliderKeyDown = (event: KeyboardEvent): void => {
		event.stopPropagation();
	};

	private readonly handleStrokeWidthSliderInput = (event: Event): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		const strokeWidth = Number(event.currentTarget.value);
		this.setStrokeWidth(strokeWidth);
		this.updateStrokeWidthPreview(strokeWidth);
	};

	private readonly handleStrokeWidthPreviewPointerMove = (event: PointerEvent): void => {
		const state = this.strokeWidthPreviewState;

		if (!state || state.pointerId !== event.pointerId) {
			return;
		}

		this.positionStrokeWidthPreview(event.clientX, event.clientY);
		this.updateStrokeWidthPreview(Number(state.sliderEl.value));
	};

	private readonly handleStrokeWidthPreviewPointerUp = (event: PointerEvent): void => {
		const state = this.strokeWidthPreviewState;

		if (!state || state.pointerId !== event.pointerId) {
			return;
		}

		this.closeStrokeWidthPreview();
	};

	private readonly handleStrokeWidthPreviewWindowBlur = (): void => {
		this.closeStrokeWidthPreview();
	};

	private readonly handleColorPaletteDocumentPointerDown = (event: PointerEvent): void => {
		const target = event.target;

		if (target instanceof Node && (this.toolbarGroupEl?.contains(target) || this.colorPaletteEl?.contains(target))) {
			return;
		}

		this.closeColorPalette();
	};

	private readonly handleColorPaletteDocumentKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.closeColorPalette();
		this.toolbarButtonEl?.focus({preventScroll: true});
	};

	private readonly handleColorPaletteWindowBlur = (): void => {
		this.closeColorPalette();
	};

	private readonly handleStrokePointerDown = (event: PointerEvent): void => {
		if (this.captureEl || event.button !== 0) {
			return;
		}

		if (this.isSpaceKeyPressed) {
			return;
		}

		const point = this.clientPointToCanvasPoint(event);

		if (!point) {
			return;
		}

		const resizeHandle = this.findResizeHandleAtPoint(point);

		if (resizeHandle && this.startStrokeResize(event.pointerId, resizeHandle)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		const stroke = this.findStrokeAtPoint(point);

		if (stroke) {
			this.handleStrokeHitPointerDown(event, point, stroke);
			return;
		}

		if (this.isPointInSelectionBox(point)) {
			const strokeIds = this.getSelectedStrokeIds();

			if (strokeIds.length > 0 && this.startStrokeDrag(event.pointerId, point, strokeIds)) {
				event.preventDefault();
				event.stopPropagation();
			}

			return;
		}

		if (isNativeCanvasContentTarget(event.target)) {
			if (!hasSelectionModifier(event)) {
				this.selectStrokes([]);
			}

			return;
		}

		this.startNativeSelectionDrag(event, point);
	};

	private readonly handleStrokePointerMove = (event: PointerEvent): void => {
		if (this.resizeState && event.pointerId === this.resizeState.pointerId) {
			this.handleStrokeResizePointerMove(event, this.resizeState);
			return;
		}

		if (this.dragState && event.pointerId === this.dragState.pointerId) {
			this.handleStrokeDragPointerMove(event, this.dragState);
			return;
		}

		if (this.nativeSelectionDragState && event.pointerId === this.nativeSelectionDragState.pointerId) {
			this.handleNativeSelectionDragPointerMove(event, this.nativeSelectionDragState);
			return;
		}

		this.updateInteractionCursorFromEvent(event);
	};

	private readonly handleStrokePointerUp = (event: PointerEvent): void => {
		if (this.resizeState && event.pointerId === this.resizeState.pointerId) {
			this.handleStrokeResizePointerUp(event, this.resizeState);
			return;
		}

		if (this.dragState && event.pointerId === this.dragState.pointerId) {
			this.handleStrokeDragPointerUp(event, this.dragState);
			return;
		}

		if (this.nativeSelectionDragState && event.pointerId === this.nativeSelectionDragState.pointerId) {
			this.handleNativeSelectionDragPointerUp(event, this.nativeSelectionDragState);
		}
	};

	private updateInteractionCursorFromEvent(event: PointerEvent): void {
		if (this.captureEl || this.isSpaceKeyPressed || isNativeCanvasContentTarget(event.target)) {
			this.setInteractionCursor(null);
			return;
		}

		const point = this.clientPointToCanvasPoint(event);

		if (!point) {
			this.setInteractionCursor(null);
			return;
		}

		const resizeHandle = this.findResizeHandleAtPoint(point);
		this.setInteractionCursor(resizeHandle ? getResizeHandleCursor(resizeHandle) : null);
	}

	private setInteractionCursor(cursor: string | null): void {
		if (this.interactionCursor === cursor) {
			return;
		}

		this.interactionCursor = cursor;
		this.strokeInteractionEl?.setCssStyles({cursor: cursor ?? ""});
	}

	private readonly handleStrokePointerLeave = (): void => {
		if (this.resizeState || this.dragState || this.nativeSelectionDragState) {
			return;
		}

		this.setInteractionCursor(null);
	};

	private handleStrokeHitPointerDown(event: PointerEvent, point: StrokePoint, stroke: CanvasStroke): void {
		event.preventDefault();
		event.stopPropagation();

		const isSelected = this.selectedStrokeIds.has(stroke.id);

		if (hasSelectionModifier(event)) {
			if (isSelected) {
				this.selectedStrokeIds.delete(stroke.id);
				this.syncSelectedStrokeElements();
				this.renderSelectionBox();
				return;
			}

			this.selectStrokes([...this.selectedStrokeIds, stroke.id]);
		} else if (!isSelected) {
			this.selectStrokes([stroke.id]);
		}

		this.startStrokeDrag(event.pointerId, point, this.getSelectedStrokeIds());
	}

	private startStrokeDrag(pointerId: number, startPoint: StrokePoint, strokeIds: readonly string[]): boolean {
		const strokeGroupEls = strokeIds.map((strokeId) => this.findStrokeGroupEl(strokeId)).filter(isPresent);

		if (strokeGroupEls.length === 0) {
			return false;
		}

		this.clearNativeSelectionDrag();
		this.dragState = {
			pointerId,
			strokeIds: [...strokeIds],
			startPoint,
			currentDelta: {x: 0, y: 0},
			strokeGroupEls,
			hasMoved: false,
		};

		if (this.strokeInteractionEl) {
			trySetPointerCapture(this.strokeInteractionEl, pointerId);
		}

		return true;
	}

	private handleStrokeDragPointerMove(event: PointerEvent, dragState: StrokeDragState): void {
		const point = this.clientPointToCanvasPoint(event);

		if (!point) {
			return;
		}

		const delta = {
			x: roundCoordinate(point.x - dragState.startPoint.x),
			y: roundCoordinate(point.y - dragState.startPoint.y),
		};

		if (!dragState.hasMoved && Math.hypot(delta.x, delta.y) < DRAG_MOVE_THRESHOLD) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		dragState.hasMoved = true;
		dragState.currentDelta = delta;
		this.applyStrokeDragTransform(dragState, delta);
	}

	private handleStrokeDragPointerUp(event: PointerEvent, dragState: StrokeDragState): void {
		event.preventDefault();
		event.stopPropagation();

		if (this.strokeInteractionEl?.hasPointerCapture(event.pointerId)) {
			this.strokeInteractionEl.releasePointerCapture(event.pointerId);
		}

		this.dragState = null;
		this.clearStrokeDragTransform(dragState);

		if (!dragState.hasMoved) {
			return;
		}

		const delta = dragState.currentDelta;
		const movedStrokeIds: string[] = [];

		for (const strokeId of dragState.strokeIds) {
			const stroke = this.findStroke(strokeId);

			if (!stroke) {
				continue;
			}

			this.translateStroke(stroke, delta);
			this.updateStrokeElement(stroke);
			movedStrokeIds.push(strokeId);
		}

		if (movedStrokeIds.length === 0) {
			this.renderSelectionBox();
			return;
		}

		this.selectStrokes(movedStrokeIds);
		this.pushHistory({
			type: "move-strokes",
			strokeIds: movedStrokeIds,
			delta,
		});
		this.hasPendingSave = true;
		this.scheduleSave();
	}

	private startStrokeResize(pointerId: number, handle: ResizeHandle): boolean {
		const selection = this.getSelectedStrokeBounds();
		const strokeIds = this.getSelectedStrokeIds();
		const strokeGroupEls = strokeIds.map((strokeId) => this.findStrokeGroupEl(strokeId)).filter(isPresent);

		if (!selection || strokeGroupEls.length === 0) {
			return false;
		}

		const outerBounds = expandBounds(selection.bounds, selection.padding);
		const origin = getResizeHandlePoint(outerBounds, getOppositeResizeHandle(handle));
		const referencePoint = getResizeHandlePoint(outerBounds, handle);
		const referenceDistance = Math.max(distanceBetween(origin, referencePoint), 1);

		this.clearNativeSelectionDrag();
		this.dragState = null;
		this.resizeState = {
			pointerId,
			strokeIds,
			handle,
			origin,
			referencePoint,
			referenceDistance,
			currentScale: 1,
			strokeGroupEls,
			hasMoved: false,
		};

		this.setInteractionCursor(getResizeHandleCursor(handle));
		if (this.strokeInteractionEl) {
			trySetPointerCapture(this.strokeInteractionEl, pointerId);
		}

		return true;
	}

	private handleStrokeResizePointerMove(event: PointerEvent, resizeState: StrokeResizeState): void {
		const point = this.clientPointToCanvasPoint(event);

		if (!point) {
			return;
		}

		const scale = Math.max(MIN_RESIZE_SCALE, distanceBetween(resizeState.origin, point) / resizeState.referenceDistance);

		if (!resizeState.hasMoved && Math.abs(scale - 1) < RESIZE_SCALE_EPSILON) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.setInteractionCursor(getResizeHandleCursor(resizeState.handle));
		resizeState.hasMoved = true;
		resizeState.currentScale = scale;
		this.applyStrokeResizeTransform(resizeState, scale);
	}

	private handleStrokeResizePointerUp(event: PointerEvent, resizeState: StrokeResizeState): void {
		event.preventDefault();
		event.stopPropagation();

		if (this.strokeInteractionEl?.hasPointerCapture(event.pointerId)) {
			this.strokeInteractionEl.releasePointerCapture(event.pointerId);
		}

		this.resizeState = null;
		this.clearStrokeResizeTransform(resizeState);
		this.updateInteractionCursorFromEvent(event);

		if (!resizeState.hasMoved || Math.abs(resizeState.currentScale - 1) < RESIZE_SCALE_EPSILON) {
			this.renderSelectionBox();
			return;
		}

		const resizedStrokeIds: string[] = [];

		for (const strokeId of resizeState.strokeIds) {
			const stroke = this.findStroke(strokeId);

			if (!stroke) {
				continue;
			}

			this.scaleStroke(stroke, resizeState.origin, resizeState.currentScale);
			this.updateStrokeElement(stroke);
			resizedStrokeIds.push(strokeId);
		}

		if (resizedStrokeIds.length === 0) {
			this.renderSelectionBox();
			return;
		}

		this.selectStrokes(resizedStrokeIds);
		this.pushHistory({
			type: "resize-strokes",
			strokeIds: resizedStrokeIds,
			origin: resizeState.origin,
			scale: resizeState.currentScale,
		});
		this.hasPendingSave = true;
		this.scheduleSave();
		this.updateInteractionCursorFromEvent(event);
	}

	private startNativeSelectionDrag(event: PointerEvent, point: StrokePoint): void {
		const state: NativeSelectionDragState = {
			pointerId: event.pointerId,
			startPoint: point,
			currentPoint: point,
			initialSelectedStrokeIds: new Set(this.selectedStrokeIds),
			isAdditive: hasSelectionModifier(event),
			hasMoved: false,
		};

		this.nativeSelectionDragState = state;

		if (!state.isAdditive) {
			this.selectStrokes([]);
		}
	}

	private handleNativeSelectionDragPointerMove(event: PointerEvent, state: NativeSelectionDragState): void {
		const point = this.clientPointToCanvasPoint(event);

		if (!point) {
			return;
		}

		const delta = {
			x: point.x - state.startPoint.x,
			y: point.y - state.startPoint.y,
		};

		if (!state.hasMoved && Math.hypot(delta.x, delta.y) < DRAG_MOVE_THRESHOLD) {
			return;
		}

		state.hasMoved = true;
		state.currentPoint = point;
		this.selectStrokes(this.getNativeSelectionDragStrokeIds(state));
	}

	private handleNativeSelectionDragPointerUp(_event: PointerEvent, state: NativeSelectionDragState): void {
		this.nativeSelectionDragState = null;

		if (!state.hasMoved) {
			if (!state.isAdditive) {
				this.selectStrokes([]);
			}

			return;
		}

		this.selectStrokes(this.getNativeSelectionDragStrokeIds(state));
	}

	private getNativeSelectionDragStrokeIds(state: NativeSelectionDragState): string[] {
		const selectionBounds = getBoundsFromPoints(state.startPoint, state.currentPoint);
		const selectedStrokeIds = state.isAdditive ? new Set(state.initialSelectedStrokeIds) : new Set<string>();

		for (const stroke of this.drawingData.strokes) {
			const bounds = this.getStrokeBounds(stroke);

			if (!bounds || !doBoundsIntersect(selectionBounds, bounds, Math.max(stroke.width / 2, 1))) {
				continue;
			}

			selectedStrokeIds.add(stroke.id);
		}

		return this.drawingData.strokes
			.map((stroke) => stroke.id)
			.filter((strokeId) => selectedStrokeIds.has(strokeId));
	}

	private clearNativeSelectionDrag(): void {
		this.nativeSelectionDragState = null;
	}


	private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
		if (isSpaceKeyEvent(event) && !isEditableEventTarget(event.target)) {
			this.isSpaceKeyPressed = true;
			return;
		}

		if (this.captureEl || this.selectedStrokeIds.size === 0) {
			return;
		}

		if (event.key !== "Delete" && event.key !== "Backspace") {
			return;
		}

		if (isEditableEventTarget(event.target)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.deleteSelectedStrokes();
	};

	private readonly handleDocumentKeyUp = (event: KeyboardEvent): void => {
		if (isSpaceKeyEvent(event)) {
			this.isSpaceKeyPressed = false;
		}
	};

	private readonly handleWindowBlur = (): void => {
		this.isSpaceKeyPressed = false;
	};

	private readonly handleCanvasUndoPointerDown = (event: PointerEvent): void => {
		if (this.undoStack.length === 0) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.suppressNextNativeUndoClick = true;
		void this.undoLastStroke();
	};

	private readonly handleCanvasRedoPointerDown = (event: PointerEvent): void => {
		if (this.redoStack.length === 0) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		void this.redoLastStroke();
		this.suppressNextNativeRedoClick = true;
	};

	private readonly handleCanvasUndoClick = (event: MouseEvent): void => {
		if (!this.suppressNextNativeUndoClick) {
			return;
		}

		this.suppressNextNativeUndoClick = false;
		event.preventDefault();
		event.stopPropagation();
	};

	private readonly handleCanvasRedoClick = (event: MouseEvent): void => {
		if (!this.suppressNextNativeRedoClick) {
			return;
		}

		this.suppressNextNativeRedoClick = false;
		event.preventDefault();
		event.stopPropagation();
	};

	private readonly handleCanvasUndoKeyDown = (event: KeyboardEvent): void => {
		if (!isActivationKey(event) || this.undoStack.length === 0) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.suppressNextNativeUndoClick = true;
		void this.undoLastStroke();
	};

	private readonly handleCanvasRedoKeyDown = (event: KeyboardEvent): void => {
		if (!isActivationKey(event) || this.redoStack.length === 0) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.suppressNextNativeRedoClick = true;
		void this.redoLastStroke();
	};

	private finishActiveStroke(): void {
		if (!this.activeStroke) {
			return;
		}

		const completedStroke = this.activeStroke;
		this.cancelActiveStrokePreviewUpdate();
		const firstPoint = completedStroke.points[0];

		if (firstPoint && completedStroke.points.length === 1) {
			const dotEndPoint = {
				x: roundCoordinate(firstPoint.x + 0.01),
				y: roundCoordinate(firstPoint.y + 0.01),
			};

			completedStroke.points.push(dotEndPoint);
		}

		this.setStrokeBounds(completedStroke);
		this.activeStrokeGroupEl?.replaceWith(this.createStrokeGroupEl(completedStroke));
		this.activeStroke = null;
		this.activeStrokeGroupEl = null;
		this.activeStrokePathEl = null;
		this.pushHistory({type: "add-stroke", stroke: cloneStroke(completedStroke)});
		this.scheduleSave();
	}

	private selectStrokes(strokeIds: readonly string[]): void {
		this.selectedStrokeIds.clear();

		for (const strokeId of strokeIds) {
			if (this.findStroke(strokeId)) {
				this.selectedStrokeIds.add(strokeId);
			}
		}

		this.syncSelectedStrokeElements();
		this.renderSelectionBox();
	}

	private getSelectedStrokeIds(): string[] {
		const selectedStrokeIds: string[] = [];

		for (const stroke of this.drawingData.strokes) {
			if (this.selectedStrokeIds.has(stroke.id)) {
				selectedStrokeIds.push(stroke.id);
			}
		}

		return selectedStrokeIds;
	}

	private syncSelectedStrokeElements(): void {
		for (const [strokeId, groupEl] of this.strokeGroupById) {
			if (!groupEl.isConnected) {
				this.strokeGroupById.delete(strokeId);
				continue;
			}

			groupEl.classList.toggle("is-selected", this.selectedStrokeIds.has(strokeId));
		}
	}

	private renderSelectionBox(): void {
		this.removeSelectionOverlay();

		const selection = this.getSelectedStrokeBounds();

		if (!this.svgEl || !selection) {
			return;
		}

		const outerBounds = expandBounds(selection.bounds, selection.padding);

		const rectEl = document.createElementNS(SVG_NS, "rect");
		rectEl.classList.add("draw-in-canvas-selection-box");
		rectEl.setAttribute("x", roundCoordinate(outerBounds.minX).toString());
		rectEl.setAttribute("y", roundCoordinate(outerBounds.minY).toString());
		rectEl.setAttribute("width", roundCoordinate(outerBounds.maxX - outerBounds.minX).toString());
		rectEl.setAttribute("height", roundCoordinate(outerBounds.maxY - outerBounds.minY).toString());
		rectEl.setAttribute("rx", "4");
		rectEl.setAttribute("pointer-events", "none");
		this.svgEl.appendChild(rectEl);
		this.selectionBoxEl = rectEl;

		for (const handle of ["nw", "ne", "se", "sw"] as const) {
			const handleEl = this.createSelectionHandleEl(handle, outerBounds);
			this.svgEl.appendChild(handleEl);
			this.selectionHandleEls.push(handleEl);
		}
	}

	private removeSelectionOverlay(): void {
		this.selectionBoxEl?.remove();
		this.selectionBoxEl = null;

		for (const handleEl of this.selectionHandleEls.splice(0)) {
			handleEl.remove();
		}
	}

	private createSelectionHandleEl(handle: ResizeHandle, bounds: StrokeBounds): SVGRectElement {
		const point = getResizeHandlePoint(bounds, handle);
		const handleEl = document.createElementNS(SVG_NS, "rect");
		handleEl.classList.add("draw-in-canvas-selection-handle", `mod-${handle}`);
		handleEl.dataset.resizeHandle = handle;
		handleEl.setAttribute("x", roundCoordinate(point.x - RESIZE_HANDLE_SIZE / 2).toString());
		handleEl.setAttribute("y", roundCoordinate(point.y - RESIZE_HANDLE_SIZE / 2).toString());
		handleEl.setAttribute("width", RESIZE_HANDLE_SIZE.toString());
		handleEl.setAttribute("height", RESIZE_HANDLE_SIZE.toString());
		handleEl.setAttribute("rx", "2");
		handleEl.setAttribute("pointer-events", "none");
		return handleEl;
	}

	private findResizeHandleAtPoint(point: StrokePoint): ResizeHandle | null {
		const selection = this.getSelectedStrokeBounds();

		if (!selection) {
			return null;
		}

		const bounds = expandBounds(selection.bounds, selection.padding);
		const hitRadius = RESIZE_HANDLE_SIZE / 2 + RESIZE_HANDLE_HIT_PADDING;

		let closestHandle: ResizeHandle | null = null;
		let closestDistance = Number.POSITIVE_INFINITY;

		for (const handle of ["nw", "ne", "se", "sw"] as const) {
			const distance = distanceBetween(point, getResizeHandlePoint(bounds, handle));

			if (distance <= hitRadius && distance < closestDistance) {
				closestHandle = handle;
				closestDistance = distance;
			}
		}

		return closestHandle;
	}

	private getSelectedStrokeBounds(): SelectionBounds | null {
		if (this.selectedStrokeIds.size === 0) {
			return null;
		}

		let selectionBounds: StrokeBounds | null = null;
		let padding = 4;

		for (const strokeId of this.selectedStrokeIds) {
			const stroke = this.findStroke(strokeId);

			if (!stroke) {
				continue;
			}

			const bounds = this.getStrokeBounds(stroke);

			if (!bounds) {
				continue;
			}

			selectionBounds = selectionBounds ? mergeBounds(selectionBounds, bounds) : bounds;
			padding = Math.max(padding, stroke.width, 4);
		}

		return selectionBounds ? {bounds: selectionBounds, padding} : null;
	}

	private isPointInSelectionBox(point: StrokePoint): boolean {
		const selection = this.getSelectedStrokeBounds();
		return selection ? isPointNearBounds(point, selection.bounds, selection.padding) : false;
	}

	private deleteSelectedStrokes(): void {
		const selectedEntries = this.drawingData.strokes
			.map((stroke, index) => ({stroke, index}))
			.filter(({stroke}) => this.selectedStrokeIds.has(stroke.id));

		if (selectedEntries.length === 0) {
			return;
		}

		this.pushHistory({
			type: "delete-strokes",
			strokes: selectedEntries.map(({stroke}) => cloneStroke(stroke)),
			indices: selectedEntries.map(({index}) => index),
		});
		this.removeStrokes(selectedEntries.map(({stroke}) => stroke.id));
		this.selectStrokes([]);
		this.hasPendingSave = true;
		this.scheduleSave();
	}

	private updateStrokeElement(stroke: CanvasStroke): void {
		if (!this.svgEl) {
			return;
		}

		const existingGroupEl = this.findStrokeGroupEl(stroke.id);
		const nextGroupEl = this.createStrokeGroupEl(stroke);

		if (existingGroupEl) {
			existingGroupEl.replaceWith(nextGroupEl);
		} else {
			this.svgEl.appendChild(nextGroupEl);
		}
	}

	private pushHistory(action: DrawingHistoryAction): void {
		this.undoStack.push(cloneHistoryAction(action));
		this.redoStack.length = 0;
		this.syncCanvasUndoRedoButtons();
	}

	private applyHistoryAction(action: DrawingHistoryAction, direction: "undo" | "redo"): void {
		switch (action.type) {
			case "add-stroke":
				if (direction === "undo") {
					this.removeStrokes([action.stroke.id]);
					this.selectStrokes([]);
				} else {
					const stroke = cloneStroke(action.stroke);
					this.addStroke(stroke);
					this.updateStrokeElement(stroke);
					this.selectStrokes([stroke.id]);
				}

				break;

			case "clear-strokes":
				this.setStrokes(direction === "undo" ? cloneStrokes(action.strokes) : []);
				this.selectStrokes([]);
				this.renderStrokes();
				break;

			case "delete-strokes":
				if (direction === "undo") {
					this.insertStrokesAtIndices(action.strokes, action.indices);
					this.selectStrokes(action.strokes.map((stroke) => stroke.id));
					this.renderStrokes();
				} else {
					this.removeStrokes(action.strokes.map((stroke) => stroke.id));
					this.selectStrokes([]);
				}

				break;

			case "move-stroke": {
				const stroke = this.findStroke(action.strokeId);

				if (stroke) {
					this.translateStroke(stroke, direction === "undo" ? negatePoint(action.delta) : action.delta);
					this.updateStrokeElement(stroke);
					this.selectStrokes([action.strokeId]);
				}

				break;
			}

			case "move-strokes": {
				const delta = direction === "undo" ? negatePoint(action.delta) : action.delta;
				const movedStrokeIds: string[] = [];

				for (const strokeId of action.strokeIds) {
					const stroke = this.findStroke(strokeId);

					if (!stroke) {
						continue;
					}

					this.translateStroke(stroke, delta);
					this.updateStrokeElement(stroke);
					movedStrokeIds.push(strokeId);
				}

				this.selectStrokes(movedStrokeIds);
				break;
			}

			case "resize-strokes": {
				const scale = direction === "undo" ? 1 / action.scale : action.scale;
				const resizedStrokeIds: string[] = [];

				for (const strokeId of action.strokeIds) {
					const stroke = this.findStroke(strokeId);

					if (!stroke) {
						continue;
					}

					this.scaleStroke(stroke, action.origin, scale);
					this.updateStrokeElement(stroke);
					resizedStrokeIds.push(strokeId);
				}

				this.selectStrokes(resizedStrokeIds);
				break;
			}

			default:
				assertNever(action);
		}
	}

	private findStroke(strokeId: string): CanvasStroke | null {
		return this.strokeById.get(strokeId) ?? null;
	}

	private findStrokeAtPoint(point: StrokePoint): CanvasStroke | null {
		for (let index = this.drawingData.strokes.length - 1; index >= 0; index--) {
			const stroke = this.drawingData.strokes[index];

			if (!stroke) {
				continue;
			}

			const hitThreshold = Math.max(stroke.width + HIT_TARGET_PADDING, 12) / 2;
			const bounds = this.getStrokeBounds(stroke);

			if (!bounds || !isPointNearBounds(point, bounds, hitThreshold)) {
				continue;
			}

			if (distanceToPolyline(point, stroke.points, hitThreshold) <= hitThreshold) {
				return stroke;
			}
		}

		return null;
	}

	private removeStroke(strokeId: string): void {
		const strokeIndex = this.drawingData.strokes.findIndex((stroke) => stroke.id === strokeId);

		if (strokeIndex !== -1) {
			this.drawingData.strokes.splice(strokeIndex, 1);
		}

		this.strokeById.delete(strokeId);
		this.strokeBoundsById.delete(strokeId);
		this.findStrokeGroupEl(strokeId)?.remove();
		this.strokeGroupById.delete(strokeId);
	}

	private findStrokeGroupEl(strokeId: string): SVGGElement | null {
		const groupEl = this.strokeGroupById.get(strokeId);

		if (!groupEl?.isConnected) {
			this.strokeGroupById.delete(strokeId);
			return null;
		}

		return groupEl;
	}

	private rebuildStrokeIndex(): void {
		this.strokeById.clear();
		this.strokeBoundsById.clear();

		for (const stroke of this.drawingData.strokes) {
			this.strokeById.set(stroke.id, stroke);
			this.setStrokeBounds(stroke);
		}
	}

	private setStrokes(strokes: CanvasStroke[]): void {
		this.drawingData.strokes = strokes;
		this.rebuildStrokeIndex();
	}

	private addStroke(stroke: CanvasStroke): void {
		this.drawingData.strokes.push(stroke);
		this.strokeById.set(stroke.id, stroke);
		this.setStrokeBounds(stroke);
	}

	private removeStrokes(strokeIds: readonly string[]): void {
		const strokeIdSet = new Set(strokeIds);
		this.drawingData.strokes = this.drawingData.strokes.filter((stroke) => !strokeIdSet.has(stroke.id));

		for (const strokeId of strokeIdSet) {
			this.strokeById.delete(strokeId);
			this.strokeBoundsById.delete(strokeId);
			this.findStrokeGroupEl(strokeId)?.remove();
			this.strokeGroupById.delete(strokeId);
			this.selectedStrokeIds.delete(strokeId);
		}

		this.renderSelectionBox();
	}

	private insertStrokesAtIndices(strokes: readonly CanvasStroke[], indices: readonly number[]): void {
		for (let index = 0; index < strokes.length; index++) {
			const sourceStroke = strokes[index];

			if (!sourceStroke) {
				continue;
			}

			const stroke = cloneStroke(sourceStroke);
			const insertIndex = Math.max(0, Math.min(indices[index] ?? this.drawingData.strokes.length, this.drawingData.strokes.length));

			this.drawingData.strokes.splice(insertIndex, 0, stroke);
			this.strokeById.set(stroke.id, stroke);
			this.setStrokeBounds(stroke);
		}
	}

	private getStrokeBounds(stroke: CanvasStroke): StrokeBounds | null {
		return this.strokeBoundsById.get(stroke.id) ?? this.setStrokeBounds(stroke);
	}

	private setStrokeBounds(stroke: CanvasStroke): StrokeBounds | null {
		const bounds = getStrokeBounds(stroke);

		if (bounds) {
			this.strokeBoundsById.set(stroke.id, bounds);
		} else {
			this.strokeBoundsById.delete(stroke.id);
		}

		return bounds;
	}

	private translateStroke(stroke: CanvasStroke, delta: StrokePoint): void {
		translatePointsInPlace(stroke.points, delta);

		const bounds = this.strokeBoundsById.get(stroke.id);

		if (bounds) {
			this.strokeBoundsById.set(stroke.id, translateBounds(bounds, delta));
		} else {
			this.setStrokeBounds(stroke);
		}
	}

	private scaleStroke(stroke: CanvasStroke, origin: StrokePoint, scale: number): void {
		scalePointsInPlace(stroke.points, origin, scale);
		stroke.width = Math.max(0.01, roundCoordinate(stroke.width * scale));

		const bounds = this.strokeBoundsById.get(stroke.id);

		if (bounds) {
			this.strokeBoundsById.set(stroke.id, scaleBounds(bounds, origin, scale));
		} else {
			this.setStrokeBounds(stroke);
		}
	}

	private applyStrokeDragTransform(dragState: StrokeDragState, delta: StrokePoint): void {
		const transform = translateToTransform(delta);
		for (const strokeGroupEl of dragState.strokeGroupEls) {
			strokeGroupEl.setAttribute("transform", transform);
		}

		this.selectionBoxEl?.setAttribute("transform", transform);
		for (const handleEl of this.selectionHandleEls) {
			handleEl.setAttribute("transform", transform);
		}
	}

	private clearStrokeDragTransform(dragState: StrokeDragState): void {
		for (const strokeGroupEl of dragState.strokeGroupEls) {
			strokeGroupEl.removeAttribute("transform");
		}

		this.selectionBoxEl?.removeAttribute("transform");
		for (const handleEl of this.selectionHandleEls) {
			handleEl.removeAttribute("transform");
		}
	}

	private applyStrokeResizeTransform(resizeState: StrokeResizeState, scale: number): void {
		const transform = scaleToTransform(resizeState.origin, scale);

		for (const strokeGroupEl of resizeState.strokeGroupEls) {
			strokeGroupEl.setAttribute("transform", transform);
		}

		this.selectionBoxEl?.setAttribute("transform", transform);

		for (const handleEl of this.selectionHandleEls) {
			handleEl.setAttribute("transform", transform);
		}
	}

	private clearStrokeResizeTransform(resizeState: StrokeResizeState): void {
		for (const strokeGroupEl of resizeState.strokeGroupEls) {
			strokeGroupEl.removeAttribute("transform");
		}

		this.selectionBoxEl?.removeAttribute("transform");

		for (const handleEl of this.selectionHandleEls) {
			handleEl.removeAttribute("transform");
		}
	}

	private clientPointToCanvasPoint(event: PointerEvent): StrokePoint | null {
		if (!this.svgEl) {
			return null;
		}

		const matrix = this.svgEl.getScreenCTM();

		if (matrix) {
			const point = this.svgEl.createSVGPoint();
			point.x = event.clientX;
			point.y = event.clientY;
			const canvasPoint = point.matrixTransform(matrix.inverse());

			return {
				x: roundCoordinate(canvasPoint.x),
				y: roundCoordinate(canvasPoint.y),
			};
		}

		const rect = this.svgEl.getBoundingClientRect();
		return {
			x: roundCoordinate(event.clientX - rect.left),
			y: roundCoordinate(event.clientY - rect.top),
		};
	}

	private scheduleSave(): void {
		this.hasPendingSave = true;

		if (this.saveTimeoutId !== null) {
			window.clearTimeout(this.saveTimeoutId);
		}

		this.saveTimeoutId = window.setTimeout(() => {
			this.saveTimeoutId = null;
			void this.saveNow();
		}, SAVE_DEBOUNCE_MS);
	}

	private async saveNow(): Promise<void> {
		if (!this.hasPendingSave) {
			return;
		}

		this.hasPendingSave = false;

		try {
			await saveCanvasDrawingData(this.app, this.target.file, this.drawingData);
		} catch (error) {
			this.hasPendingSave = true;
			console.error("Draw in canvas could not save strokes", error);
			new Notice("Draw in canvas could not save strokes. See console for details.");
		}
	}

	private findViewContentEl(): HTMLElement {
		return this.target.containerEl.querySelector<HTMLElement>(".view-content") ?? this.target.containerEl;
	}

	private findCanvasWrapperEl(): HTMLElement {
		return this.target.containerEl.querySelector<HTMLElement>(".canvas-wrapper") ?? this.findViewContentEl();
	}

	private findCanvasWorldEl(): HTMLElement {
		return this.target.containerEl.querySelector<HTMLElement>(".canvas") ?? this.findViewContentEl();
	}

	private hideStaleElements(): void {
		const ownedElements = new Set<Element>();

		if (this.captureEl) {
			ownedElements.add(this.captureEl);
		}

		if (this.svgEl) {
			ownedElements.add(this.svgEl);
		}

		if (this.toolbarGroupEl) {
			ownedElements.add(this.toolbarGroupEl);
		}

		if (this.colorPaletteEl) {
			ownedElements.add(this.colorPaletteEl);
		}

		hideStaleDrawInCanvasElements(this.target.containerEl, ownedElements);
	}

	private ensurePositioned(element: HTMLElement): void {
		if (getComputedStyle(element).position !== "static") {
			return;
		}

		this.positionedEl = element;
		this.previousPosition = element.style.position;
		element.setCssStyles({position: "relative"});
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

function getHandwrittenStrokeShapePath(stroke: CanvasStroke): string {
	const shapePoints = getHandwrittenStrokeShapePoints(stroke);

	if (!shapePoints) {
		return "";
	}

	const lastRightPoint = shapePoints.right[shapePoints.right.length - 1];

	if (!lastRightPoint) {
		return "";
	}

	return `${pointsToSmoothClosedEdgePath(shapePoints.left)} L ${formatPathPoint(lastRightPoint)} ${pointsToSmoothClosedEdgePath(shapePoints.right, true)} Z`;
}

function getHandwrittenStrokeShapePoints(stroke: CanvasStroke): {left: StrokePoint[]; right: StrokePoint[]} | null {
	const usablePoints = getUsableStrokePoints(stroke.points);

	if (usablePoints.length < 2) {
		return null;
	}

	const left: StrokePoint[] = [];
	const right: StrokePoint[] = [];
	const seed = getStrokeSeed(stroke.id);
	const cumulativeDistances = getCumulativeDistances(usablePoints);
	const totalLength = cumulativeDistances[cumulativeDistances.length - 1] ?? 0;

	for (let index = 0; index < usablePoints.length; index++) {
		const point = usablePoints[index];

		if (!point) {
			continue;
		}

		const tangent = getStrokeTangent(usablePoints, index);

		if (!tangent) {
			continue;
		}

		const distanceFromStart = cumulativeDistances[index] ?? 0;
		const distanceFromEnd = Math.max(0, totalLength - distanceFromStart);
		const halfWidth = getHandwrittenHalfWidth(stroke.width, index, seed, distanceFromStart, distanceFromEnd);
		const normal = {x: -tangent.y, y: tangent.x};

		left.push({
			x: roundCoordinate(point.x + normal.x * halfWidth),
			y: roundCoordinate(point.y + normal.y * halfWidth),
		});
		right.push({
			x: roundCoordinate(point.x - normal.x * halfWidth),
			y: roundCoordinate(point.y - normal.y * halfWidth),
		});
	}

	return left.length >= 2 && right.length >= 2 ? {left, right} : null;
}

function getUsableStrokePoints(points: readonly StrokePoint[]): StrokePoint[] {
	const usablePoints: StrokePoint[] = [];

	for (const point of points) {
		const previousPoint = usablePoints[usablePoints.length - 1];

		if (!previousPoint || distanceBetween(previousPoint, point) >= 0.01) {
			usablePoints.push(point);
		}
	}

	return usablePoints;
}

function getCumulativeDistances(points: readonly StrokePoint[]): number[] {
	const distances = [0];

	for (let index = 1; index < points.length; index++) {
		const previousPoint = points[index - 1];
		const point = points[index];
		const previousDistance = distances[index - 1] ?? 0;

		distances[index] = previousPoint && point
			? previousDistance + distanceBetween(previousPoint, point)
			: previousDistance;
	}

	return distances;
}

function getStrokeTangent(points: readonly StrokePoint[], index: number): StrokePoint | null {
	const previousPoint = points[Math.max(0, index - 1)];
	const nextPoint = points[Math.min(points.length - 1, index + 1)];

	if (!previousPoint || !nextPoint) {
		return null;
	}

	const dx = nextPoint.x - previousPoint.x;
	const dy = nextPoint.y - previousPoint.y;
	const length = Math.hypot(dx, dy);

	if (length === 0) {
		return null;
	}

	return {x: dx / length, y: dy / length};
}

function getHandwrittenHalfWidth(
	width: number,
	index: number,
	seed: number,
	distanceFromStart: number,
	distanceFromEnd: number,
): number {
	const taperDistance = Math.max(HANDWRITTEN_TAPER_MIN_LENGTH, width * HANDWRITTEN_TAPER_LENGTH_MULTIPLIER);
	const taperAmount = Math.min(1, distanceFromStart / taperDistance, distanceFromEnd / taperDistance);
	const easedTaper = 0.24 + 0.76 * smoothStep(taperAmount);
	const wobble = 1 + 0.045 * Math.sin(seed + index * 1.61803398875);
	return Math.max(0.35, width * easedTaper * wobble / 2);
}

function smoothStep(value: number): number {
	const clampedValue = Math.min(1, Math.max(0, value));
	return clampedValue * clampedValue * (3 - 2 * clampedValue);
}

function pointsToSmoothClosedEdgePath(points: readonly StrokePoint[], reverse = false): string {
	const pointCount = points.length;

	if (pointCount === 0) {
		return "";
	}

	const firstPoint = reverse ? points[pointCount - 1] : points[0];

	if (!firstPoint) {
		return "";
	}

	const commands = [reverse ? "" : `M ${formatPathPoint(firstPoint)}`];

	for (let offset = 1; offset < pointCount; offset++) {
		const currentIndex = reverse ? pointCount - 1 - offset : offset;
		const previousIndex = reverse ? currentIndex + 1 : currentIndex - 1;
		const currentPoint = points[currentIndex];
		const previousPoint = points[previousIndex];

		if (!currentPoint || !previousPoint) {
			continue;
		}

		const softenedPoint = {
			x: roundCoordinate(previousPoint.x + (currentPoint.x - previousPoint.x) * HANDWRITTEN_EDGE_FOLLOW),
			y: roundCoordinate(previousPoint.y + (currentPoint.y - previousPoint.y) * HANDWRITTEN_EDGE_FOLLOW),
		};

		commands.push(`Q ${formatPathPoint(previousPoint)} ${formatPathPoint(softenedPoint)}`);
	}

	const lastPoint = reverse ? points[0] : points[pointCount - 1];

	if (lastPoint) {
		commands.push(`L ${formatPathPoint(lastPoint)}`);
	}

	return commands.filter(Boolean).join(" ");
}

function formatPathPoint(point: StrokePoint): string {
	return `${roundCoordinate(point.x)} ${roundCoordinate(point.y)}`;
}

function getStrokeSeed(strokeId: string): number {
	let seed = 0;

	for (let index = 0; index < strokeId.length; index++) {
		seed = (seed * 31 + strokeId.charCodeAt(index)) % 9973;
	}

	return seed;
}

function trySetPointerCapture(element: Element, pointerId: number): void {
	try {
		element.setPointerCapture(pointerId);
	} catch (error) {
		if (error instanceof DOMException && error.name === "NotFoundError") {
			return;
		}

		throw error;
	}
}

function getZoomControlGroup(controlsEl: HTMLElement): Element | null {
	return Array.from(controlsEl.children).find((child) => child.classList.contains("canvas-control-group"))?.nextElementSibling ?? null;
}

function findCanvasControlButton(controlsEl: HTMLElement, label: string): HTMLElement | null {
	return Array.from(controlsEl.querySelectorAll<HTMLElement>(".canvas-control-item"))
		.find((buttonEl) => buttonEl.getAttribute("aria-label")?.startsWith(label)) ?? null;
}


function isActivationKey(event: KeyboardEvent): boolean {
	return event.key === "Enter" || event.key === " ";
}

function colorsMatch(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function formatStrokeWidth(width: number): string {
	return `${normalizeStrokeWidth(width)}px`;
}

function hasSelectionModifier(event: MouseEvent | PointerEvent): boolean {
	return event.shiftKey || event.ctrlKey || event.metaKey;
}

function isSpaceKeyEvent(event: KeyboardEvent): boolean {
	return event.code === "Space" || event.key === " ";
}

function isEditableEventTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return target.isContentEditable
		|| target instanceof HTMLInputElement
		|| target instanceof HTMLTextAreaElement
		|| target instanceof HTMLSelectElement;
}

function isNativeCanvasContentTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) {
		return false;
	}

	return Boolean(target.closest(
		".canvas-node, .canvas-edge, .canvas-card-menu, .canvas-controls, .canvas-control-group, .canvas-control-item",
	));
}

function isPresent<T>(value: T | null): value is T {
	return value !== null;
}
function distanceBetween(a: StrokePoint, b: StrokePoint): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToPolyline(point: StrokePoint, points: readonly StrokePoint[], stopAtDistance?: number): number {
	const firstPoint = points[0];

	if (!firstPoint) {
		return Number.POSITIVE_INFINITY;
	}

	if (points.length === 1) {
		return distanceBetween(point, firstPoint);
	}

	let shortestDistance = Number.POSITIVE_INFINITY;

	for (let index = 1; index < points.length; index++) {
		const from = points[index - 1];
		const to = points[index];

		if (!from || !to) {
			continue;
		}

		shortestDistance = Math.min(shortestDistance, distanceToSegment(point, from, to));

		if (stopAtDistance !== undefined && shortestDistance <= stopAtDistance) {
			return shortestDistance;
		}
	}

	return shortestDistance;
}

function distanceToSegment(point: StrokePoint, from: StrokePoint, to: StrokePoint): number {
	const segmentX = to.x - from.x;
	const segmentY = to.y - from.y;
	const lengthSquared = segmentX * segmentX + segmentY * segmentY;

	if (lengthSquared === 0) {
		return distanceBetween(point, from);
	}

	const projection = Math.max(0, Math.min(1, ((point.x - from.x) * segmentX + (point.y - from.y) * segmentY) / lengthSquared));
	const closestPoint = {
		x: from.x + projection * segmentX,
		y: from.y + projection * segmentY,
	};

	return distanceBetween(point, closestPoint);
}

function getStrokeBounds(stroke: CanvasStroke): StrokeBounds | null {
	const firstPoint = stroke.points[0];

	if (!firstPoint) {
		return null;
	}

	let minX = firstPoint.x;
	let maxX = firstPoint.x;
	let minY = firstPoint.y;
	let maxY = firstPoint.y;

	for (let index = 1; index < stroke.points.length; index++) {
		const point = stroke.points[index];

		if (!point) {
			continue;
		}

		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}

	return {minX, minY, maxX, maxY};
}

function mergeBounds(a: StrokeBounds, b: StrokeBounds): StrokeBounds {
	return {
		minX: Math.min(a.minX, b.minX),
		minY: Math.min(a.minY, b.minY),
		maxX: Math.max(a.maxX, b.maxX),
		maxY: Math.max(a.maxY, b.maxY),
	};
}

function getBoundsFromPoints(a: StrokePoint, b: StrokePoint): StrokeBounds {
	return {
		minX: Math.min(a.x, b.x),
		minY: Math.min(a.y, b.y),
		maxX: Math.max(a.x, b.x),
		maxY: Math.max(a.y, b.y),
	};
}

function doBoundsIntersect(a: StrokeBounds, b: StrokeBounds, padding = 0): boolean {
	return a.minX <= b.maxX + padding
		&& a.maxX >= b.minX - padding
		&& a.minY <= b.maxY + padding
		&& a.maxY >= b.minY - padding;
}

function isPointNearBounds(point: StrokePoint, bounds: StrokeBounds, padding: number): boolean {
	return point.x >= bounds.minX - padding
		&& point.x <= bounds.maxX + padding
		&& point.y >= bounds.minY - padding
		&& point.y <= bounds.maxY + padding;
}

function expandBounds(bounds: StrokeBounds, padding: number): StrokeBounds {
	return {
		minX: bounds.minX - padding,
		minY: bounds.minY - padding,
		maxX: bounds.maxX + padding,
		maxY: bounds.maxY + padding,
	};
}

function getResizeHandlePoint(bounds: StrokeBounds, handle: ResizeHandle): StrokePoint {
	switch (handle) {
		case "nw":
			return {x: bounds.minX, y: bounds.minY};

		case "ne":
			return {x: bounds.maxX, y: bounds.minY};

		case "se":
			return {x: bounds.maxX, y: bounds.maxY};

		case "sw":
			return {x: bounds.minX, y: bounds.maxY};

		default:
			return assertNever(handle);
	}
}

function getOppositeResizeHandle(handle: ResizeHandle): ResizeHandle {
	switch (handle) {
		case "nw":
			return "se";

		case "ne":
			return "sw";

		case "se":
			return "nw";

		case "sw":
			return "ne";

		default:
			return assertNever(handle);
	}
}

function getResizeHandleCursor(handle: ResizeHandle): string {
	switch (handle) {
		case "nw":
		case "se":
			return "nwse-resize";

		case "ne":
		case "sw":
			return "nesw-resize";

		default:
			return assertNever(handle);
	}
}

function translatePointsInPlace(points: StrokePoint[], delta: StrokePoint): void {
	for (const point of points) {
		point.x = roundCoordinate(point.x + delta.x);
		point.y = roundCoordinate(point.y + delta.y);
	}
}

function scalePointsInPlace(points: StrokePoint[], origin: StrokePoint, scale: number): void {
	for (const point of points) {
		point.x = roundCoordinate(origin.x + (point.x - origin.x) * scale);
		point.y = roundCoordinate(origin.y + (point.y - origin.y) * scale);
	}
}

function translateBounds(bounds: StrokeBounds, delta: StrokePoint): StrokeBounds {
	return {
		minX: roundCoordinate(bounds.minX + delta.x),
		minY: roundCoordinate(bounds.minY + delta.y),
		maxX: roundCoordinate(bounds.maxX + delta.x),
		maxY: roundCoordinate(bounds.maxY + delta.y),
	};
}

function scaleBounds(bounds: StrokeBounds, origin: StrokePoint, scale: number): StrokeBounds {
	const topLeft = scalePoint({x: bounds.minX, y: bounds.minY}, origin, scale);
	const topRight = scalePoint({x: bounds.maxX, y: bounds.minY}, origin, scale);
	const bottomRight = scalePoint({x: bounds.maxX, y: bounds.maxY}, origin, scale);
	const bottomLeft = scalePoint({x: bounds.minX, y: bounds.maxY}, origin, scale);

	return {
		minX: Math.min(topLeft.x, topRight.x, bottomRight.x, bottomLeft.x),
		minY: Math.min(topLeft.y, topRight.y, bottomRight.y, bottomLeft.y),
		maxX: Math.max(topLeft.x, topRight.x, bottomRight.x, bottomLeft.x),
		maxY: Math.max(topLeft.y, topRight.y, bottomRight.y, bottomLeft.y),
	};
}

function scalePoint(point: StrokePoint, origin: StrokePoint, scale: number): StrokePoint {
	return {
		x: roundCoordinate(origin.x + (point.x - origin.x) * scale),
		y: roundCoordinate(origin.y + (point.y - origin.y) * scale),
	};
}

function negatePoint(point: StrokePoint): StrokePoint {
	return {x: -point.x, y: -point.y};
}

function translateToTransform(delta: StrokePoint): string {
	return `translate(${delta.x} ${delta.y})`;
}

function scaleToTransform(origin: StrokePoint, scale: number): string {
	const formattedScale = formatScale(scale);
	return `translate(${origin.x} ${origin.y}) scale(${formattedScale}) translate(${-origin.x} ${-origin.y})`;
}

function formatScale(value: number): string {
	return Number(value.toFixed(4)).toString();
}

function clonePoint(point: StrokePoint): StrokePoint {
	return {x: point.x, y: point.y};
}

function clonePoints(points: readonly StrokePoint[]): StrokePoint[] {
	return points.map(clonePoint);
}

function cloneStroke(stroke: CanvasStroke): CanvasStroke {
	return {
		...stroke,
		points: clonePoints(stroke.points),
	};
}

function cloneStrokes(strokes: readonly CanvasStroke[]): CanvasStroke[] {
	return strokes.map(cloneStroke);
}

function cloneHistoryAction(action: DrawingHistoryAction): DrawingHistoryAction {
	switch (action.type) {
		case "add-stroke":
			return {type: "add-stroke", stroke: cloneStroke(action.stroke)};

		case "clear-strokes":
			return {type: "clear-strokes", strokes: cloneStrokes(action.strokes)};

		case "delete-strokes":
			return {
				type: "delete-strokes",
				strokes: cloneStrokes(action.strokes),
				indices: [...action.indices],
			};

		case "move-stroke":
			return {
				type: "move-stroke",
				strokeId: action.strokeId,
				delta: clonePoint(action.delta),
			};

		case "move-strokes":
			return {
				type: "move-strokes",
				strokeIds: [...action.strokeIds],
				delta: clonePoint(action.delta),
			};

		case "resize-strokes":
			return {
				type: "resize-strokes",
				strokeIds: [...action.strokeIds],
				origin: clonePoint(action.origin),
				scale: action.scale,
			};

		default:
			return assertNever(action);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unexpected history action: ${JSON.stringify(value)}`);
}