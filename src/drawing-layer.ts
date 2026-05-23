import {App, Notice, setIcon} from "obsidian";
import {loadCanvasDrawingData, saveCanvasDrawingData} from "./canvas-file";
import {CanvasTarget} from "./canvas-target";
import {
	DrawInCanvasSettings,
	FREEHAND_SLIDER_SETTINGS,
	FreehandSliderSetting,
	STROKE_HARDNESS_MAX,
	STROKE_HARDNESS_MIN,
	STROKE_HARDNESS_STEP,
	STROKE_OPACITY_MAX,
	STROKE_OPACITY_MIN,
	STROKE_OPACITY_STEP,
	STROKE_WIDTH_MAX,
	STROKE_WIDTH_MIN,
	STROKE_WIDTH_STEP,
	normalizeFreehandSliderValue,
	normalizeStrokeHardness,
	normalizeStrokeOpacity,
	normalizeStrokeWidth,
} from "./settings";
import {
	CanvasDrawingData,
	CanvasStroke,
	StrokePoint,
	normalizeStrokePressure,
	createEmptyDrawingData,
	createStrokeId,
	pointsToSvgPath,
	roundCoordinate,
} from "./types";
import {getStroke} from "./perfect-freehand";

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
const ACTIVE_STROKE_PREVIEW_WINDOW_SIZE = 160;
const ACTIVE_STROKE_PREVIEW_CHUNK_SIZE = 96;
const ACTIVE_STROKE_PREVIEW_OVERLAP = 8;
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
] as const;
const DEFAULT_CUSTOM_COLOR = "#8b5cf6";
const CUSTOM_COLOR_SHADE_COUNT = 6;
const COLOR_PALETTE_TABS = [
	{id: "disc", label: "Disc"},
	{id: "palettes", label: "Palettes"},
] as const;
const COLOR_WHEEL_HUE_RING_RADIUS_PERCENT = 40.25;
const COLOR_WHEEL_HUE_KEYBOARD_STEP = 2;
const COLOR_WHEEL_HUE_KEYBOARD_LARGE_STEP = 15;
const COLOR_WHEEL_KEYBOARD_STEP = 0.02;
const COLOR_WHEEL_KEYBOARD_LARGE_STEP = 0.1;
const COLOR_WHEEL_DISC_THUMB_SIZE_PX = 14;
const STALE_ELEMENT_SELECTOR = ".draw-in-canvas-control-group, .draw-in-canvas-render-layer, .draw-in-canvas-capture-layer, .draw-in-canvas-brush-controls, .draw-in-canvas-color-palette, .draw-in-canvas-stroke-settings-palette, .draw-in-canvas-brush-preview, .draw-in-canvas-stroke-width-preview, .draw-in-canvas-pen-cursor";
const STALE_ELEMENT_CLASS = "draw-in-canvas-stale";
const BRUSH_POPOVER_OPEN_BODY_CLASS = "draw-in-canvas-color-palette-open";

interface StrokeBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface RgbColor {
	r: number;
	g: number;
	b: number;
}

interface HsvColor {
	h: number;
	s: number;
	v: number;
}

type ResizeHandle = "nw" | "ne" | "se" | "sw";
type BrushSliderSetting = "size" | "opacity";
type ColorPaletteTab = typeof COLOR_PALETTE_TABS[number]["id"];
type ColorWheelControl = "hue" | "disc";
type CanvasPointMapper = (event: PointerEvent) => StrokePoint;

interface StrokeRenderOptions {
	hasPressure?: boolean;
	isStart?: boolean;
	isEnd?: boolean;
}

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

interface BrushPreviewState {
	pointerId: number;
	triggerEl: HTMLElement;
	setting: BrushSliderSetting;
	x: number;
	y: number;
}

interface PenCursorPosition {
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
	private readonly requestSetStrokeHardness: (hardness: number) => void;
	private readonly requestSetStrokeOpacity: (opacity: number) => void;
	private readonly requestSetFreehandSliderValue: (setting: FreehandSliderSetting, value: number) => void;
	private readonly requestSetBeautifulStrokes: (enabled: boolean) => void;
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
	private selectButtonEl: HTMLElement | null = null;
	private colorPaletteEl: HTMLElement | null = null;
	private strokeSettingsPaletteEl: HTMLElement | null = null;
	private brushControlsEl: HTMLElement | null = null;
	private brushColorButtonEl: HTMLButtonElement | null = null;
	private brushSettingsButtonEl: HTMLButtonElement | null = null;
	private colorPaletteTriggerEl: HTMLElement | null = null;
	private strokeSettingsPaletteTriggerEl: HTMLElement | null = null;
	private customColorHex = DEFAULT_CUSTOM_COLOR;
	private colorPaletteTab: ColorPaletteTab = "disc";
	private colorWheelHsv = getColorWheelHsv(DEFAULT_CUSTOM_COLOR);
	private shouldSelectCustomColorHexOnClick = false;
	private toolbarPressState: ToolbarPressState | null = null;
	private brushPreviewEl: HTMLElement | null = null;
	private brushPreviewState: BrushPreviewState | null = null;
	private penCursorEl: HTMLElement | null = null;
	private pendingPenCursorPosition: PenCursorPosition | null = null;
	private penCursorFrameId: number | null = null;
	private penCursorAppearanceKey = "";
	private undoButtonEl: HTMLElement | null = null;
	private redoButtonEl: HTMLElement | null = null;
	private activeStroke: CanvasStroke | null = null;
	private activeStrokeGroupEl: SVGGElement | null = null;
	private activeStrokePathEl: SVGPathElement | null = null;
	private activeStrokePreviewFrameId: number | null = null;
	private activeStrokePointerId: number | null = null;
	private activeStrokeHasPressure = false;
	private activeStrokePreviewCommittedPointIndex = 0;
	private readonly activeStrokePreviewChunkPathEls: SVGPathElement[] = [];
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
	private readonly strokeSettingsPaletteDisposers: Array<() => void> = [];
	private readonly brushControlsDisposers: Array<() => void> = [];
	private readonly brushPreviewDisposers: Array<() => void> = [];
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
		requestSetStrokeHardness: (hardness: number) => void,
		requestSetStrokeOpacity: (opacity: number) => void,
		requestSetFreehandSliderValue: (setting: FreehandSliderSetting, value: number) => void,
		requestSetBeautifulStrokes: (enabled: boolean) => void,
	) {
		this.app = app;
		this.target = target;
		this.settings = {...settings};
		this.customColorHex = normalizeHexColor(settings.strokeColor) ?? DEFAULT_CUSTOM_COLOR;
		this.colorWheelHsv = getColorWheelHsv(this.customColorHex, this.colorWheelHsv.h);
		this.requestToggleDrawingMode = requestToggleDrawingMode;
		this.requestSetStrokeColor = requestSetStrokeColor;
		this.requestSetStrokeWidth = requestSetStrokeWidth;
		this.requestSetStrokeHardness = requestSetStrokeHardness;
		this.requestSetStrokeOpacity = requestSetStrokeOpacity;
		this.requestSetFreehandSliderValue = requestSetFreehandSliderValue;
		this.requestSetBeautifulStrokes = requestSetBeautifulStrokes;
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
		this.mountBrushControls();
		this.syncToolbarButton();
	}

	disableDrawingMode(): void {
		this.finishActiveStroke();
		this.removePenCursor();

		for (const dispose of this.captureDisposers.splice(0)) {
			dispose();
		}

		this.captureEl?.remove();
		this.captureEl = null;

		this.removeBrushControls();

		if (this.positionedEl) {
			this.positionedEl.setCssStyles({position: this.previousPosition});
			this.positionedEl = null;
			this.previousPosition = "";
		}

		this.syncToolbarButton();
	}

	setSettings(settings: DrawInCanvasSettings): void {
		const shouldRerenderStrokes = shouldRerenderForSettingsChange(this.settings, settings);

		this.settings = {...settings};
		this.updateCustomColorFromStrokeColor();
		this.syncToolbarButton();
		this.syncColorPaletteSelection();
		this.syncStrokeSettingsPaletteControls();
		this.syncBrushControls();

		if (!this.settings.usePenCursorFallback) {
			this.hidePenCursor();
		} else {
			this.penCursorAppearanceKey = "";
		}

		if (shouldRerenderStrokes) {
			if (this.activeStroke) {
				this.resetActiveStrokePreviewState();
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
			this.addListener(captureEl, "pointerleave", this.handlePointerLeave),
			this.addListener(captureEl, "keydown", this.handleKeyDown),
			this.addListener(window, "blur", this.handleCaptureWindowBlur),
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

		const selectButtonEl = document.createElement("div");
		selectButtonEl.classList.add("canvas-control-item", "draw-in-canvas-control-item", "draw-in-canvas-select-control-item");
		selectButtonEl.setAttribute("aria-label", "Select canvas items (1)");
		selectButtonEl.setAttribute("data-tooltip-position", "left");
		selectButtonEl.setAttribute("role", "button");
		selectButtonEl.setAttribute("aria-keyshortcuts", "1");
		selectButtonEl.tabIndex = 0;
		setIcon(selectButtonEl, "mouse-pointer-2");

		const buttonEl = document.createElement("div");
		buttonEl.classList.add("canvas-control-item", "draw-in-canvas-control-item", "draw-in-canvas-pencil-control-item");
		buttonEl.setAttribute("aria-label", "Toggle drawing mode. Long press or press the down arrow for stroke color");
		buttonEl.setAttribute("data-tooltip-position", "left");
		buttonEl.setAttribute("role", "button");
		buttonEl.setAttribute("aria-haspopup", "dialog");
		buttonEl.setAttribute("aria-expanded", "false");
		buttonEl.tabIndex = 0;
		setIcon(buttonEl, "pencil");

		groupEl.append(selectButtonEl, buttonEl);
		controlsEl.insertBefore(groupEl, getZoomControlGroup(controlsEl));

		this.toolbarGroupEl = groupEl;
		this.selectButtonEl = selectButtonEl;
		this.toolbarButtonEl = buttonEl;
		this.toolbarDisposers.push(
			this.addListener(selectButtonEl, "pointerdown", this.handleSelectToolbarPointerDown),
			this.addListener(selectButtonEl, "keydown", this.handleSelectToolbarKeyDown),
			this.addListener(buttonEl, "pointerdown", this.handleToolbarPointerDown),
			this.addListener(buttonEl, "pointerup", this.handleToolbarPointerUp),
			this.addListener(buttonEl, "pointercancel", this.handleToolbarPointerCancel),
			this.addListener(buttonEl, "keydown", this.handleToolbarKeyDown),
		);
		this.syncToolbarButton();
		this.hideStaleElements();
	}

	private removeToolbarButton(): void {
		this.closeBrushPopovers();
		this.clearToolbarPressState();
		for (const dispose of this.toolbarDisposers.splice(0)) {
			dispose();
		}

		this.toolbarGroupEl?.remove();
		this.toolbarGroupEl = null;
		this.toolbarButtonEl = null;
		this.selectButtonEl = null;
	}

	private syncToolbarButton(): void {
		if (!this.toolbarButtonEl) {
			return;
		}

		const isEnabled = this.isDrawingEnabled();
		this.selectButtonEl?.classList.toggle("is-active", !isEnabled);
		this.selectButtonEl?.setAttribute("aria-pressed", (!isEnabled).toString());
		this.toolbarButtonEl.classList.toggle("is-active", isEnabled);
		this.toolbarButtonEl.setAttribute("aria-pressed", isEnabled.toString());
		this.toolbarButtonEl.setCssProps({"--draw-in-canvas-current-color": this.settings.strokeColor});
		this.syncColorPaletteExpandedState();
		this.syncStrokeSettingsPaletteExpandedState();
	}

	private mountBrushControls(): void {
		if (!this.captureEl) {
			this.removeBrushControls();
			return;
		}

		const controlsParentEl = this.findCanvasWrapperEl();

		if (this.brushControlsEl?.isConnected && this.brushControlsEl.parentElement === controlsParentEl) {
			this.syncBrushControls();
			this.hideStaleElements();
			return;
		}

		this.removeBrushControls();

		const controlsEl = document.createElement("div");
		controlsEl.classList.add("draw-in-canvas-brush-controls");
		controlsEl.setAttribute("role", "group");
		controlsEl.setAttribute("aria-label", "Brush size, color, stroke settings, and opacity");
		const colorButtonEl = this.createBrushColorButtonEl();
		const settingsButtonEl = this.createBrushSettingsButtonEl();

		controlsEl.append(
			this.createBrushSizeSliderControlEl(),
			colorButtonEl,
			settingsButtonEl,
			this.createBrushOpacitySliderControlEl(),
		);

		controlsParentEl.appendChild(controlsEl);
		this.brushControlsEl = controlsEl;
		this.syncBrushControls();
		this.hideStaleElements();
	}

	private removeBrushControls(): void {
		this.closeBrushPopovers();
		this.closeBrushPreview();

		for (const dispose of this.brushControlsDisposers.splice(0)) {
			dispose();
		}

		this.brushControlsEl?.remove();
		this.brushControlsEl = null;
		this.brushColorButtonEl = null;
		this.brushSettingsButtonEl = null;
	}

	private createBrushSizeSliderControlEl(): HTMLElement {
		const sliderEl = createBrushSliderControlEl(
			"size",
			"Brush size",
			"draw-in-canvas-brush-size-value",
			formatStrokeWidth(normalizeStrokeWidth(this.settings.strokeWidth)),
		);
		sliderEl.classList.add("draw-in-canvas-brush-size-slider");

		this.brushControlsDisposers.push(
			this.addListener(sliderEl, "pointerdown", this.handleBrushSliderPointerDown),
			this.addListener(sliderEl, "pointermove", this.handleBrushSliderPointerMove),
			this.addListener(sliderEl, "pointerup", this.handleBrushSliderPointerUp),
			this.addListener(sliderEl, "pointercancel", this.handleBrushSliderPointerUp),
			this.addListener(sliderEl, "keydown", this.handleBrushSliderKeyDown),
		);

		return sliderEl;
	}

	private createBrushColorButtonEl(): HTMLButtonElement {
		const buttonEl = document.createElement("button");
		buttonEl.type = "button";
		buttonEl.classList.add("draw-in-canvas-brush-color-button");
		buttonEl.setAttribute("aria-label", "Open stroke color");
		buttonEl.setAttribute("aria-haspopup", "dialog");
		buttonEl.setAttribute("aria-expanded", (this.colorPaletteEl?.isConnected ?? false).toString());
		this.brushColorButtonEl = buttonEl;

		this.brushControlsDisposers.push(
			this.addListener(buttonEl, "pointerdown", this.handleBrushButtonPointerDown),
			this.addListener(buttonEl, "click", this.handleBrushColorButtonClick),
			this.addListener(buttonEl, "keydown", this.handleBrushButtonKeyDown),
		);

		return buttonEl;
	}

	private createBrushSettingsButtonEl(): HTMLButtonElement {
		const buttonEl = document.createElement("button");
		buttonEl.type = "button";
		buttonEl.classList.add("draw-in-canvas-brush-settings-button");
		buttonEl.setAttribute("aria-label", "Open stroke and handwriting settings");
		buttonEl.setAttribute("aria-haspopup", "dialog");
		buttonEl.setAttribute("aria-expanded", (this.strokeSettingsPaletteEl?.isConnected ?? false).toString());
		setIcon(buttonEl, "sliders-horizontal");
		this.brushSettingsButtonEl = buttonEl;

		this.brushControlsDisposers.push(
			this.addListener(buttonEl, "pointerdown", this.handleBrushButtonPointerDown),
			this.addListener(buttonEl, "click", this.handleBrushSettingsButtonClick),
			this.addListener(buttonEl, "keydown", this.handleBrushButtonKeyDown),
		);

		return buttonEl;
	}

	private createBrushOpacitySliderControlEl(): HTMLElement {
		const sliderEl = createBrushSliderControlEl(
			"opacity",
			"Brush opacity",
			"draw-in-canvas-brush-opacity-value",
			formatStrokeOpacity(normalizeStrokeOpacity(this.settings.strokeOpacity)),
		);
		sliderEl.classList.add("draw-in-canvas-brush-opacity-slider");

		this.brushControlsDisposers.push(
			this.addListener(sliderEl, "pointerdown", this.handleBrushSliderPointerDown),
			this.addListener(sliderEl, "pointermove", this.handleBrushSliderPointerMove),
			this.addListener(sliderEl, "pointerup", this.handleBrushSliderPointerUp),
			this.addListener(sliderEl, "pointercancel", this.handleBrushSliderPointerUp),
			this.addListener(sliderEl, "keydown", this.handleBrushSliderKeyDown),
		);

		return sliderEl;
	}

	private syncBrushControls(): void {
		if (!this.brushControlsEl) {
			return;
		}

		this.brushControlsEl.setCssProps({
			"--draw-in-canvas-current-color": this.settings.strokeColor,
		});

		this.syncColorPaletteExpandedState();
		this.syncStrokeSettingsPaletteExpandedState();

		this.syncBrushSlider(
			"size",
			".draw-in-canvas-brush-size-slider",
			".draw-in-canvas-brush-size-value",
			normalizeStrokeWidth(this.settings.strokeWidth),
			formatStrokeWidth,
			"Brush size",
		);
		this.syncBrushSlider(
			"opacity",
			".draw-in-canvas-brush-opacity-slider",
			".draw-in-canvas-brush-opacity-value",
			normalizeStrokeOpacity(this.settings.strokeOpacity),
			formatStrokeOpacity,
			"Brush opacity",
		);
	}

	private syncBrushSlider(
		setting: BrushSliderSetting,
		sliderSelector: string,
		valueSelector: string,
		value: number,
		formatValue: (value: number) => string,
		label: string,
	): void {
		const bounds = getBrushSliderBounds(setting);
		const valueText = formatValue(value);
		const sliderEl = this.brushControlsEl?.querySelector<HTMLElement>(sliderSelector);
		const valueEl = this.brushControlsEl?.querySelector<HTMLElement>(valueSelector);

		if (sliderEl) {
			sliderEl.title = `${label}: ${valueText}`;
			sliderEl.setCssProps({"--draw-in-canvas-brush-slider-position": formatBrushSliderThumbPosition(setting, value)});
			sliderEl.setAttribute("aria-valuemin", bounds.min.toString());
			sliderEl.setAttribute("aria-valuemax", bounds.max.toString());
			sliderEl.setAttribute("aria-valuenow", normalizeBrushSliderValue(setting, value).toString());
			sliderEl.setAttribute("aria-valuetext", valueText);
		}

		if (valueEl) {
			valueEl.textContent = valueText;
		}
	}

	private openColorPalette(): void {
		if (!this.isDrawingEnabled()) {
			this.enableDrawingMode();
		}

		const triggerEl = this.getColorPaletteTriggerEl();

		if (!triggerEl) {
			return;
		}

		this.closeStrokeSettingsPalette();
		this.colorPaletteTriggerEl = triggerEl;

		if (this.colorPaletteEl?.isConnected) {
			this.syncColorPaletteSelection();
			this.syncColorPaletteTabControls();
			this.positionColorPalette();
			this.syncColorPaletteExpandedState();
			this.syncPopoverOpenBodyClass();
			return;
		}

		this.closeColorPalette();
		this.colorPaletteTriggerEl = triggerEl;

		const paletteEl = document.createElement("div");
		paletteEl.classList.add("draw-in-canvas-color-palette");
		paletteEl.setAttribute("role", "dialog");

		const paletteLabelEl = document.createElement("span");
		paletteLabelEl.id = createStrokeId();
		paletteLabelEl.classList.add("draw-in-canvas-visually-hidden");
		paletteLabelEl.textContent = "Stroke color";
		paletteEl.setAttribute("aria-labelledby", paletteLabelEl.id);
		paletteEl.appendChild(paletteLabelEl);

		const panelIds: Record<ColorPaletteTab, string> = {
			disc: createStrokeId(),
			palettes: createStrokeId(),
		};
		const swatchEls: HTMLButtonElement[] = [];
		const panelsEl = document.createElement("div");
		panelsEl.classList.add("draw-in-canvas-color-palette-panels");
		panelsEl.append(
			this.createColorDiscPanelEl(panelIds.disc),
			this.createPresetPalettePanelEl(panelIds.palettes, swatchEls),
		);

		paletteEl.append(
			this.createColorPaletteHeaderEl(),
			panelsEl,
			this.createColorPaletteTabsEl(panelIds),
		);

		document.body.appendChild(paletteEl);
		this.colorPaletteEl = paletteEl;
		this.syncPopoverOpenBodyClass();
		this.syncColorPaletteExpandedState();
		this.colorPaletteDisposers.push(
			this.addListener(document, "pointerdown", this.handleBrushPopoverDocumentPointerDown, true),
			this.addListener(document, "keydown", this.handleColorPaletteDocumentKeyDown, true),
		);
		this.syncColorPaletteSelection();
		this.syncColorPaletteTabControls();
		this.positionColorPalette();

		const selectedSwatchEl = swatchEls.find((swatchEl) => colorsMatch(swatchEl.dataset.color ?? "", this.settings.strokeColor));
		const focusEl = this.colorPaletteTab === "palettes"
			? selectedSwatchEl ?? swatchEls[0]
			: paletteEl.querySelector<HTMLElement>(".draw-in-canvas-color-wheel-disc-field")
				?? paletteEl.querySelector<HTMLElement>(".draw-in-canvas-color-palette-tab.is-active")
				?? selectedSwatchEl
				?? swatchEls[0];
		window.requestAnimationFrame(() => focusEl?.focus({preventScroll: true}));
	}

	private getColorPaletteTriggerEl(): HTMLElement | null {
		if (this.brushColorButtonEl?.isConnected) {
			return this.brushColorButtonEl;
		}

		return this.toolbarButtonEl?.isConnected ? this.toolbarButtonEl : null;
	}

	private getColorPaletteAnchorEl(): HTMLElement | null {
		if (this.brushControlsEl?.isConnected) {
			return this.brushControlsEl;
		}

		return this.getColorPaletteTriggerEl();
	}

	private positionColorPalette(): void {
		const anchorEl = this.getColorPaletteAnchorEl();

		if (!this.colorPaletteEl || !anchorEl) {
			return;
		}

		this.positionBrushPopover(this.colorPaletteEl, anchorEl);
	}

	private openStrokeSettingsPalette(): void {
		if (!this.isDrawingEnabled()) {
			this.enableDrawingMode();
		}

		const triggerEl = this.getStrokeSettingsPaletteTriggerEl();

		if (!triggerEl) {
			return;
		}

		this.closeColorPalette();
		this.strokeSettingsPaletteTriggerEl = triggerEl;

		if (this.strokeSettingsPaletteEl?.isConnected) {
			this.positionStrokeSettingsPalette();
			this.syncStrokeSettingsPaletteControls();
			this.syncStrokeSettingsPaletteExpandedState();
			this.syncPopoverOpenBodyClass();
			return;
		}

		this.closeStrokeSettingsPalette();
		this.strokeSettingsPaletteTriggerEl = triggerEl;

		const paletteEl = document.createElement("div");
		paletteEl.classList.add("draw-in-canvas-stroke-settings-palette");
		paletteEl.setAttribute("role", "dialog");

		const paletteLabelEl = document.createElement("span");
		paletteLabelEl.id = createStrokeId();
		paletteLabelEl.classList.add("draw-in-canvas-visually-hidden");
		paletteLabelEl.textContent = "Stroke and handwriting settings";
		paletteEl.setAttribute("aria-labelledby", paletteLabelEl.id);
		paletteEl.appendChild(paletteLabelEl);
		paletteEl.appendChild(this.createStrokeSettingsControlEl());

		document.body.appendChild(paletteEl);
		this.strokeSettingsPaletteEl = paletteEl;
		this.syncPopoverOpenBodyClass();
		this.positionStrokeSettingsPalette();
		this.syncStrokeSettingsPaletteExpandedState();
		this.strokeSettingsPaletteDisposers.push(
			this.addListener(document, "pointerdown", this.handleBrushPopoverDocumentPointerDown, true),
			this.addListener(document, "keydown", this.handleStrokeSettingsPaletteDocumentKeyDown, true),
		);
		this.syncStrokeSettingsPaletteControls();

		const firstControlEl = paletteEl.querySelector<HTMLElement>("input, button");
		window.requestAnimationFrame(() => firstControlEl?.focus({preventScroll: true}));
	}

	private getStrokeSettingsPaletteTriggerEl(): HTMLElement | null {
		return this.brushSettingsButtonEl?.isConnected ? this.brushSettingsButtonEl : null;
	}

	private getStrokeSettingsPaletteAnchorEl(): HTMLElement | null {
		if (this.brushControlsEl?.isConnected) {
			return this.brushControlsEl;
		}

		return this.getStrokeSettingsPaletteTriggerEl();
	}

	private positionStrokeSettingsPalette(): void {
		const anchorEl = this.getStrokeSettingsPaletteAnchorEl();

		if (!this.strokeSettingsPaletteEl || !anchorEl) {
			return;
		}

		this.positionBrushPopover(this.strokeSettingsPaletteEl, anchorEl);
	}

	private positionBrushPopover(popoverEl: HTMLElement, anchorEl: HTMLElement): void {
		const anchorRect = anchorEl.getBoundingClientRect();
		const popoverRect = popoverEl.getBoundingClientRect();
		const viewportMargin = 8;
		const gap = 8;
		const top = Math.max(
			viewportMargin,
			Math.min(anchorRect.top, window.innerHeight - popoverRect.height - viewportMargin),
		);

		if (this.brushControlsEl?.isConnected) {
			const left = Math.max(
				viewportMargin,
				Math.min(anchorRect.right + gap, window.innerWidth - popoverRect.width - viewportMargin),
			);

			popoverEl.setCssStyles({
				top: `${top}px`,
				left: `${left}px`,
				right: "auto",
			});
			return;
		}

		const right = Math.max(viewportMargin, window.innerWidth - anchorRect.left + gap);

		popoverEl.setCssStyles({
			top: `${top}px`,
			right: `${right}px`,
			left: "auto",
		});
	}

	private closeBrushPopovers(): void {
		this.closeColorPalette();
		this.closeStrokeSettingsPalette();
	}

	private closeColorPalette(): void {
		this.closeBrushPreview();
		for (const dispose of this.colorPaletteDisposers.splice(0)) {
			dispose();
		}

		this.colorPaletteEl?.remove();
		this.colorPaletteEl = null;
		this.colorPaletteTriggerEl = null;
		this.syncPopoverOpenBodyClass();
		this.syncColorPaletteExpandedState();
	}

	private closeStrokeSettingsPalette(): void {
		this.closeBrushPreview();
		for (const dispose of this.strokeSettingsPaletteDisposers.splice(0)) {
			dispose();
		}

		this.strokeSettingsPaletteEl?.remove();
		this.strokeSettingsPaletteEl = null;
		this.strokeSettingsPaletteTriggerEl = null;
		this.syncPopoverOpenBodyClass();
		this.syncStrokeSettingsPaletteExpandedState();
	}

	private syncPopoverOpenBodyClass(): void {
		document.body.classList.toggle(
			BRUSH_POPOVER_OPEN_BODY_CLASS,
			(this.colorPaletteEl?.isConnected ?? false) || (this.strokeSettingsPaletteEl?.isConnected ?? false),
		);
	}

	private syncColorPaletteExpandedState(): void {
		const isOpen = (this.colorPaletteEl?.isConnected ?? false).toString();
		this.toolbarButtonEl?.setAttribute("aria-expanded", isOpen);
		this.brushColorButtonEl?.setAttribute("aria-expanded", isOpen);
	}

	private syncStrokeSettingsPaletteExpandedState(): void {
		const isOpen = (this.strokeSettingsPaletteEl?.isConnected ?? false).toString();
		this.brushSettingsButtonEl?.setAttribute("aria-expanded", isOpen);
	}

	private syncColorPaletteSelection(): void {
		const swatchEls = this.colorPaletteEl?.querySelectorAll<HTMLElement>(".draw-in-canvas-preset-color-swatch") ?? [];

		for (const swatchEl of Array.from(swatchEls)) {
			const isSelected = colorsMatch(swatchEl.dataset.color ?? "", this.settings.strokeColor);
			swatchEl.classList.toggle("is-selected", isSelected);
			swatchEl.setAttribute("aria-pressed", isSelected.toString());
		}

		this.syncCustomColorControls();
		this.syncColorWheelControls();
		this.syncColorPaletteHeader();
	}

	private syncStrokeSettingsPaletteControls(): void {
		const paletteEl = this.strokeSettingsPaletteEl;
		const handwritingToggleEl = paletteEl?.querySelector<HTMLInputElement>(".draw-in-canvas-handwriting-toggle-input");
		const handwritingControlsEl = paletteEl?.querySelector<HTMLElement>(".draw-in-canvas-freehand-controls");

		if (handwritingToggleEl) {
			handwritingToggleEl.checked = this.settings.beautifulStrokes;
		}

		handwritingControlsEl?.classList.toggle("is-disabled", !this.settings.beautifulStrokes);
		handwritingControlsEl?.setAttribute("aria-disabled", (!this.settings.beautifulStrokes).toString());

		this.syncPaletteSlider(
			paletteEl,
			".draw-in-canvas-stroke-hardness-slider",
			".draw-in-canvas-stroke-hardness-value",
			normalizeStrokeHardness(this.settings.strokeHardness),
			formatStrokeHardness,
		);

		for (const setting of getFreehandSliderSettingKeys()) {
			const value = normalizeFreehandSliderValue(setting, this.settings[setting]);
			const selector = `[data-freehand-setting="${setting}"]`;

			this.syncPaletteSlider(
				paletteEl,
				selector,
				`[data-freehand-value="${setting}"]`,
				value,
				(valueToFormat) => formatFreehandSliderValue(setting, valueToFormat),
			);

			const sliderEl = paletteEl?.querySelector<HTMLInputElement>(selector);

			if (sliderEl) {
				sliderEl.disabled = !this.settings.beautifulStrokes;
			}
		}
	}

	private syncPaletteSlider(
		paletteEl: HTMLElement | null,
		sliderSelector: string,
		valueSelector: string,
		value: number,
		formatValue: (value: number) => string,
	): void {
		const sliderEl = paletteEl?.querySelector<HTMLInputElement>(sliderSelector);
		const valueEl = paletteEl?.querySelector<HTMLElement>(valueSelector);

		if (sliderEl) {
			sliderEl.value = value.toString();
		}

		if (valueEl) {
			valueEl.textContent = formatValue(value);
		}
	}

	private syncCustomColorControls(): void {
		this.updateCustomColorFromStrokeColor();

		const hexInputEl = this.colorPaletteEl?.querySelector<HTMLInputElement>(".draw-in-canvas-custom-color-hex-input");
		const colorPickerEl = this.colorPaletteEl?.querySelector<HTMLInputElement>(".draw-in-canvas-native-color-picker");
		const colorPickerSwatchEl = this.colorPaletteEl?.querySelector<HTMLElement>(".draw-in-canvas-color-picker-swatch");
		const shadeEls = this.colorPaletteEl?.querySelectorAll<HTMLButtonElement>(".draw-in-canvas-custom-color-shade") ?? [];

		if (hexInputEl && document.activeElement !== hexInputEl) {
			hexInputEl.value = formatHexColor(this.customColorHex);
			setHexInputValidity(hexInputEl, true);
		}

		if (colorPickerEl) {
			colorPickerEl.value = this.customColorHex;
		}

		if (colorPickerSwatchEl) {
			colorPickerSwatchEl.setCssProps({"--draw-in-canvas-swatch-color": this.customColorHex});
			colorPickerSwatchEl.classList.toggle("is-selected", colorsMatch(this.customColorHex, this.settings.strokeColor));
		}

		const shades = getCustomColorShades(this.customColorHex);

		for (const shadeEl of Array.from(shadeEls)) {
			const shadeIndex = Number(shadeEl.dataset.shadeIndex);
			const shade = shades[shadeIndex];

			if (!shade) {
				continue;
			}

			shadeEl.dataset.color = shade.value;
			shadeEl.setAttribute("aria-label", `Use ${shade.name.toLowerCase()} ${formatHexColor(shade.value)} stroke color`);
			shadeEl.setCssProps({"--draw-in-canvas-custom-shade-color": shade.value});
			shadeEl.setCssStyles({backgroundColor: shade.value});
			shadeEl.classList.toggle("is-selected", colorsMatch(shade.value, this.settings.strokeColor));
			shadeEl.setAttribute("aria-pressed", colorsMatch(shade.value, this.settings.strokeColor).toString());
		}
	}

	private syncColorWheelControls(): void {
		const wheelEl = this.colorPaletteEl?.querySelector<HTMLElement>(".draw-in-canvas-color-disc-picker");

		if (!wheelEl) {
			return;
		}

		const hueColor = hsvToHex({h: this.colorWheelHsv.h, s: 1, v: 1});
		const selectedColor = normalizeHexColor(this.customColorHex) ?? hsvToHex(this.colorWheelHsv);
		const huePosition = getColorWheelHuePosition(this.colorWheelHsv.h);
		const hueValue = Math.round(this.colorWheelHsv.h);
		const saturationValue = Math.round(this.colorWheelHsv.s * 100);
		const brightnessValue = Math.round(this.colorWheelHsv.v * 100);
		const hueControlEl = wheelEl.querySelector<HTMLElement>("[data-color-wheel-control=\"hue\"]");
		const discControlEl = wheelEl.querySelector<HTMLElement>("[data-color-wheel-control=\"disc\"]");
		const discThumbPosition = getColorWheelDiscThumbPosition(this.colorWheelHsv, discControlEl);

		wheelEl.setCssProps({
			"--draw-in-canvas-color-wheel-hue-color": hueColor,
			"--draw-in-canvas-color-wheel-selected-color": selectedColor,
			"--draw-in-canvas-color-wheel-hue-x": `${huePosition.x}%`,
			"--draw-in-canvas-color-wheel-hue-y": `${huePosition.y}%`,
			"--draw-in-canvas-color-wheel-disc-x": `${discThumbPosition.x}%`,
			"--draw-in-canvas-color-wheel-disc-y": `${discThumbPosition.y}%`,
		});

		if (hueControlEl) {
			hueControlEl.setAttribute("aria-valuenow", hueValue.toString());
			hueControlEl.setAttribute("aria-valuetext", `${hueValue}° hue`);
		}

		if (discControlEl) {
			discControlEl.setAttribute("aria-valuenow", saturationValue.toString());
			discControlEl.setAttribute("aria-valuetext", `Saturation ${saturationValue}%, brightness ${brightnessValue}%`);
		}
	}

	private syncColorPaletteHeader(): void {
		const previewEls = this.colorPaletteEl?.querySelectorAll<HTMLElement>(".draw-in-canvas-current-color-preview") ?? [];
		const labelEls = this.colorPaletteEl?.querySelectorAll<HTMLElement>(".draw-in-canvas-current-color-label") ?? [];
		const colorLabel = normalizeHexColor(this.settings.strokeColor)?.toUpperCase() ?? this.settings.strokeColor;

		for (const previewEl of Array.from(previewEls)) {
			previewEl.setCssProps({"--draw-in-canvas-current-color": this.settings.strokeColor});
		}

		for (const labelEl of Array.from(labelEls)) {
			labelEl.textContent = colorLabel;
		}
	}

	private syncColorPaletteTabControls(): void {
		const paletteEl = this.colorPaletteEl;

		if (!paletteEl) {
			return;
		}

		const tabEls = paletteEl.querySelectorAll<HTMLElement>(".draw-in-canvas-color-palette-tab");
		const panelEls = paletteEl.querySelectorAll<HTMLElement>(".draw-in-canvas-color-palette-panel");

		for (const tabEl of Array.from(tabEls)) {
			const tab = getColorPaletteTab(tabEl.dataset.colorPaletteTab);
			const isSelected = tab === this.colorPaletteTab;
			tabEl.classList.toggle("is-active", isSelected);
			tabEl.tabIndex = isSelected ? 0 : -1;
			tabEl.setAttribute("aria-selected", isSelected.toString());
		}

		for (const panelEl of Array.from(panelEls)) {
			const tab = getColorPaletteTab(panelEl.dataset.colorPalettePanel);
			const isSelected = tab === this.colorPaletteTab;
			panelEl.hidden = !isSelected;
			panelEl.classList.toggle("is-active", isSelected);
			panelEl.setAttribute("aria-hidden", (!isSelected).toString());
		}
	}

	private updateCustomColorFromStrokeColor(): void {
		const strokeColorHex = normalizeHexColor(this.settings.strokeColor);

		if (strokeColorHex) {
			this.customColorHex = strokeColorHex;
			this.colorWheelHsv = getColorWheelHsv(strokeColorHex, this.colorWheelHsv.h);
		}
	}

	private setColorWheelHsv(color: HsvColor): void {
		const nextColor = normalizeHsvColor(color);
		const hexColor = hsvToHex(nextColor);

		this.colorWheelHsv = nextColor;
		this.customColorHex = hexColor;
		this.setStrokeColor(hexColor);
		this.syncColorWheelControls();
		this.syncColorPaletteHeader();
	}

	private setStrokeColor(color: string): void {
		const hexColor = normalizeHexColor(color);

		if (hexColor) {
			this.customColorHex = hexColor;
			this.colorWheelHsv = getColorWheelHsv(hexColor, this.colorWheelHsv.h);
		}

		if (colorsMatch(color, this.settings.strokeColor)) {
			this.syncColorWheelControls();
			this.syncColorPaletteHeader();
			return;
		}

		this.settings = {...this.settings, strokeColor: color};
		this.requestSetStrokeColor(color);
		this.syncToolbarButton();
		this.syncColorPaletteSelection();
		this.syncBrushControls();
	}

	private createColorPaletteHeaderEl(): HTMLElement {
		const headerEl = document.createElement("div");
		headerEl.classList.add("draw-in-canvas-color-palette-header");

		const titleEl = document.createElement("div");
		titleEl.classList.add("draw-in-canvas-color-palette-title");
		titleEl.textContent = "Colors";

		const currentColorEl = document.createElement("div");
		currentColorEl.classList.add("draw-in-canvas-current-color");
		currentColorEl.setAttribute("aria-label", "Current stroke color");

		const previewEl = document.createElement("span");
		previewEl.classList.add("draw-in-canvas-current-color-preview");
		previewEl.setCssProps({"--draw-in-canvas-current-color": this.settings.strokeColor});

		const labelEl = document.createElement("span");
		labelEl.classList.add("draw-in-canvas-current-color-label");
		labelEl.textContent = normalizeHexColor(this.settings.strokeColor)?.toUpperCase() ?? this.settings.strokeColor;

		currentColorEl.append(previewEl, labelEl);
		headerEl.append(titleEl, currentColorEl);
		return headerEl;
	}

	private createColorDiscPanelEl(panelId: string): HTMLElement {
		const panelEl = document.createElement("div");
		panelEl.id = panelId;
		panelEl.classList.add("draw-in-canvas-color-palette-panel", "draw-in-canvas-color-disc-panel");
		panelEl.dataset.colorPalettePanel = "disc";
		panelEl.setAttribute("role", "tabpanel");

		const wheelEl = document.createElement("div");
		wheelEl.classList.add("draw-in-canvas-color-disc-picker");
		wheelEl.setAttribute("aria-label", "Color disc");

		const hueControlEl = document.createElement("div");
		hueControlEl.classList.add("draw-in-canvas-color-wheel-hue-control");
		hueControlEl.dataset.colorWheelControl = "hue";
		hueControlEl.tabIndex = 0;
		hueControlEl.setAttribute("role", "slider");
		hueControlEl.setAttribute("aria-label", "Stroke color hue");
		hueControlEl.setAttribute("aria-valuemin", "0");
		hueControlEl.setAttribute("aria-valuemax", "360");

		const hueThumbEl = document.createElement("span");
		hueThumbEl.classList.add("draw-in-canvas-color-wheel-thumb", "draw-in-canvas-color-wheel-hue-thumb");
		hueThumbEl.setAttribute("aria-hidden", "true");
		hueControlEl.appendChild(hueThumbEl);

		const discControlEl = document.createElement("div");
		discControlEl.classList.add("draw-in-canvas-color-wheel-disc-field");
		discControlEl.dataset.colorWheelControl = "disc";
		discControlEl.tabIndex = 0;
		discControlEl.setAttribute("role", "slider");
		discControlEl.setAttribute("aria-label", "Stroke color saturation and brightness");
		discControlEl.setAttribute("aria-valuemin", "0");
		discControlEl.setAttribute("aria-valuemax", "100");

		const discThumbEl = document.createElement("span");
		discThumbEl.classList.add("draw-in-canvas-color-wheel-thumb", "draw-in-canvas-color-wheel-disc-thumb");
		discThumbEl.setAttribute("aria-hidden", "true");
		discControlEl.appendChild(discThumbEl);

		for (const controlEl of [hueControlEl, discControlEl]) {
			this.colorPaletteDisposers.push(
				this.addListener(controlEl, "pointerdown", this.handleColorWheelPointerDown),
				this.addListener(controlEl, "pointermove", this.handleColorWheelPointerMove),
				this.addListener(controlEl, "pointerup", this.handleColorWheelPointerUp),
				this.addListener(controlEl, "pointercancel", this.handleColorWheelPointerUp),
				this.addListener(controlEl, "keydown", this.handleColorWheelKeyDown),
			);
		}

		wheelEl.append(hueControlEl, discControlEl);
		panelEl.append(wheelEl, this.createColorDiscPaletteEl());
		return panelEl;
	}

	private createColorDiscPaletteEl(): HTMLElement {
		const paletteEl = document.createElement("div");
		paletteEl.classList.add("draw-in-canvas-color-disc-palette");

		const titleEl = document.createElement("div");
		titleEl.classList.add("draw-in-canvas-color-disc-palette-title");
		titleEl.textContent = "Palette";

		const swatchesEl = document.createElement("div");
		swatchesEl.classList.add("draw-in-canvas-color-disc-palette-swatches");
		swatchesEl.setAttribute("aria-label", "Preset stroke colors");

		for (const color of PRESET_STROKE_COLORS) {
			const swatchEl = document.createElement("button");
			swatchEl.type = "button";
			swatchEl.classList.add("draw-in-canvas-color-disc-palette-swatch", "draw-in-canvas-preset-color-swatch");
			swatchEl.dataset.color = color.value;
			swatchEl.setAttribute("aria-label", `Use ${color.name.toLowerCase()} stroke color`);
			swatchEl.setCssProps({"--draw-in-canvas-swatch-color": color.value});
			swatchEl.setCssStyles({backgroundColor: color.value});

			this.colorPaletteDisposers.push(
				this.addListener(swatchEl, "pointerdown", this.handleColorSwatchPointerDown),
				this.addListener(swatchEl, "click", this.handlePresetColorSwatchClick),
			);

			swatchesEl.appendChild(swatchEl);
		}

		paletteEl.append(titleEl, swatchesEl);
		return paletteEl;
	}

	private createPresetPalettePanelEl(panelId: string, swatchEls: HTMLButtonElement[]): HTMLElement {
		const panelEl = document.createElement("div");
		panelEl.id = panelId;
		panelEl.classList.add("draw-in-canvas-color-palette-panel", "draw-in-canvas-presets-panel");
		panelEl.dataset.colorPalettePanel = "palettes";
		panelEl.setAttribute("role", "tabpanel");

		const swatchesEl = document.createElement("div");
		swatchesEl.classList.add("draw-in-canvas-color-palette-swatch-grid");
		swatchesEl.setAttribute("aria-label", "Preset stroke colors");

		for (const color of PRESET_STROKE_COLORS) {
			const swatchEl = document.createElement("button");
			swatchEl.type = "button";
			swatchEl.classList.add("draw-in-canvas-color-swatch", "draw-in-canvas-preset-color-swatch");
			swatchEl.dataset.color = color.value;
			swatchEl.setAttribute("aria-label", `Use ${color.name.toLowerCase()} stroke color`);
			swatchEl.setCssProps({"--draw-in-canvas-swatch-color": color.value});
			swatchEl.setCssStyles({backgroundColor: color.value});

			this.colorPaletteDisposers.push(
				this.addListener(swatchEl, "pointerdown", this.handleColorSwatchPointerDown),
				this.addListener(swatchEl, "click", this.handlePresetColorSwatchClick),
			);

			swatchesEl.appendChild(swatchEl);
			swatchEls.push(swatchEl);
		}

		panelEl.append(swatchesEl, this.createNativeColorPickerEl(), this.createCustomColorControlEl());
		return panelEl;
	}

	private createColorPaletteTabsEl(panelIds: Record<ColorPaletteTab, string>): HTMLElement {
		const tabsEl = document.createElement("div");
		tabsEl.classList.add("draw-in-canvas-color-palette-tabs");
		tabsEl.setAttribute("role", "tablist");
		tabsEl.setAttribute("aria-label", "Color picker views");

		for (const tab of COLOR_PALETTE_TABS) {
			const tabEl = document.createElement("button");
			tabEl.type = "button";
			tabEl.classList.add("draw-in-canvas-color-palette-tab");
			tabEl.dataset.colorPaletteTab = tab.id;
			tabEl.setAttribute("role", "tab");
			tabEl.setAttribute("aria-controls", panelIds[tab.id]);
			tabEl.textContent = tab.label;

			this.colorPaletteDisposers.push(
				this.addListener(tabEl, "click", this.handleColorPaletteTabClick),
				this.addListener(tabEl, "keydown", this.handleColorPaletteTabKeyDown),
			);

			tabsEl.appendChild(tabEl);
		}

		return tabsEl;
	}

	private createNativeColorPickerEl(): HTMLElement {
		const pickerLabelEl = document.createElement("label");
		pickerLabelEl.classList.add("draw-in-canvas-color-swatch", "draw-in-canvas-color-picker-swatch");
		pickerLabelEl.setAttribute("title", "Choose custom color");
		pickerLabelEl.setCssProps({"--draw-in-canvas-swatch-color": this.customColorHex});

		const pickerInputEl = document.createElement("input");
		pickerInputEl.classList.add("draw-in-canvas-native-color-picker");
		pickerInputEl.type = "color";
		pickerInputEl.value = this.customColorHex;
		pickerInputEl.setAttribute("aria-label", "Choose custom stroke color");

		const iconEl = document.createElement("span");
		iconEl.classList.add("draw-in-canvas-color-picker-icon");
		setIcon(iconEl, "palette");

		const hiddenTextEl = document.createElement("span");
		hiddenTextEl.classList.add("draw-in-canvas-visually-hidden");
		hiddenTextEl.textContent = "Choose custom stroke color";

		this.colorPaletteDisposers.push(
			this.addListener(pickerInputEl, "input", this.handleNativeColorPickerInput),
			this.addListener(pickerInputEl, "change", this.handleNativeColorPickerInput),
		);

		pickerLabelEl.append(pickerInputEl, iconEl, hiddenTextEl);
		return pickerLabelEl;
	}

	private createCustomColorControlEl(): HTMLElement {
		const controlEl = document.createElement("div");
		controlEl.classList.add("draw-in-canvas-custom-color-control");

		const fieldEl = document.createElement("div");
		fieldEl.classList.add("draw-in-canvas-custom-color-field");

		const inputId = createStrokeId();
		const labelEl = document.createElement("label");
		labelEl.htmlFor = inputId;
		labelEl.textContent = "Hex color";

		const inputEl = document.createElement("input");
		inputEl.id = inputId;
		inputEl.classList.add("draw-in-canvas-custom-color-hex-input");
		inputEl.type = "text";
		inputEl.inputMode = "text";
		inputEl.maxLength = 7;
		inputEl.pattern = "#?[0-9A-Fa-f]{6}";
		inputEl.placeholder = "#123456";
		inputEl.spellcheck = false;
		inputEl.value = formatHexColor(this.customColorHex);
		inputEl.setAttribute("aria-label", "Custom hex stroke color");

		fieldEl.append(labelEl, inputEl);

		const shadesEl = document.createElement("div");
		shadesEl.classList.add("draw-in-canvas-custom-color-shades");
		shadesEl.setAttribute("aria-label", "Custom color shades");

		for (let index = 0; index < CUSTOM_COLOR_SHADE_COUNT; index++) {
			const shadeEl = document.createElement("button");
			shadeEl.type = "button";
			shadeEl.classList.add("draw-in-canvas-custom-color-shade");
			shadeEl.dataset.shadeIndex = index.toString();

			this.colorPaletteDisposers.push(
				this.addListener(shadeEl, "pointerdown", this.handleColorSwatchPointerDown),
				this.addListener(shadeEl, "click", this.handleCustomColorShadeClick),
			);

			shadesEl.appendChild(shadeEl);
		}

		this.colorPaletteDisposers.push(
			this.addListener(inputEl, "pointerdown", this.handleCustomColorHexPointerDown),
			this.addListener(inputEl, "focus", this.handleCustomColorHexFocus),
			this.addListener(inputEl, "click", this.handleCustomColorHexClick),
			this.addListener(inputEl, "input", this.handleCustomColorHexInput),
			this.addListener(inputEl, "change", this.handleCustomColorHexChange),
			this.addListener(inputEl, "blur", this.handleCustomColorHexChange),
			this.addListener(inputEl, "keydown", this.handleCustomColorHexKeyDown),
		);

		controlEl.append(fieldEl, shadesEl);
		return controlEl;
	}

	private createStrokeSettingsControlEl(): HTMLElement {
		const controlEl = document.createElement("div");
		controlEl.classList.add("draw-in-canvas-stroke-settings-control");

		const strokeSectionEl = document.createElement("div");
		strokeSectionEl.classList.add("draw-in-canvas-palette-section");
		strokeSectionEl.appendChild(this.createPaletteSectionTitleEl("Stroke"));
		strokeSectionEl.appendChild(this.createStrokeHardnessSliderControlEl());
		controlEl.appendChild(strokeSectionEl);
		controlEl.appendChild(this.createHandwritingControlsEl());

		return controlEl;
	}

	private createStrokeHardnessSliderControlEl(): HTMLElement {
		const inputId = createStrokeId();
		const sliderEl = document.createElement("input");
		sliderEl.id = inputId;
		sliderEl.classList.add("draw-in-canvas-stroke-width-slider", "draw-in-canvas-stroke-hardness-slider");
		sliderEl.type = "range";
		sliderEl.min = STROKE_HARDNESS_MIN.toString();
		sliderEl.max = STROKE_HARDNESS_MAX.toString();
		sliderEl.step = STROKE_HARDNESS_STEP.toString();
		sliderEl.value = normalizeStrokeHardness(this.settings.strokeHardness).toString();
		sliderEl.setAttribute("aria-label", "Stroke hardness");

		this.strokeSettingsPaletteDisposers.push(
			this.addListener(sliderEl, "keydown", this.handleStrokeWidthSliderKeyDown),
			this.addListener(sliderEl, "input", this.handleStrokeHardnessSliderInput),
		);

		const controlEl = createSliderControlEl(
			inputId,
			"Hardness",
			"draw-in-canvas-stroke-width-value",
			formatStrokeHardness(normalizeStrokeHardness(this.settings.strokeHardness)),
			sliderEl,
		);
		controlEl.querySelector("output")?.classList.add("draw-in-canvas-stroke-hardness-value");
		return controlEl;
	}

	private createHandwritingControlsEl(): HTMLElement {
		const sectionEl = document.createElement("div");
		const titleId = createStrokeId();
		sectionEl.classList.add("draw-in-canvas-palette-section", "draw-in-canvas-freehand-controls");
		sectionEl.setAttribute("aria-labelledby", titleId);

		const headerEl = document.createElement("div");
		headerEl.classList.add("draw-in-canvas-palette-section-header");

		const titleEl = this.createPaletteSectionTitleEl("Handwriting");
		titleEl.id = titleId;

		const headerActionsEl = document.createElement("div");
		headerActionsEl.classList.add("draw-in-canvas-palette-section-actions");

		const resetButtonEl = document.createElement("button");
		resetButtonEl.type = "button";
		resetButtonEl.classList.add("draw-in-canvas-palette-reset-button");
		resetButtonEl.textContent = "Reset";
		resetButtonEl.setAttribute("aria-label", "Reset handwriting controls to defaults");

		const toggleLabelEl = document.createElement("label");
		toggleLabelEl.classList.add("draw-in-canvas-handwriting-toggle");

		const toggleEl = document.createElement("input");
		toggleEl.classList.add("draw-in-canvas-handwriting-toggle-input");
		toggleEl.type = "checkbox";
		toggleEl.checked = this.settings.beautifulStrokes;
		toggleEl.setAttribute("aria-label", "Enable handwritten strokes");

		const toggleTextEl = document.createElement("span");
		toggleTextEl.textContent = "On";

		toggleLabelEl.append(toggleEl, toggleTextEl);
		headerActionsEl.append(resetButtonEl, toggleLabelEl);
		headerEl.append(titleEl, headerActionsEl);
		sectionEl.appendChild(headerEl);


		for (const setting of getFreehandSliderSettingKeys()) {
			sectionEl.appendChild(this.createFreehandSliderControlEl(setting));
		}

		this.strokeSettingsPaletteDisposers.push(
			this.addListener(toggleEl, "change", this.handleHandwritingToggleChange),
			this.addListener(resetButtonEl, "click", this.handleFreehandResetClick),
		);

		return sectionEl;
	}

	private createPaletteSectionTitleEl(text: string): HTMLElement {
		const titleEl = document.createElement("div");
		titleEl.classList.add("draw-in-canvas-palette-section-title");
		titleEl.textContent = text;
		return titleEl;
	}

	private createFreehandSliderControlEl(setting: FreehandSliderSetting): HTMLElement {
		const slider = FREEHAND_SLIDER_SETTINGS[setting];
		const inputId = createStrokeId();
		const value = normalizeFreehandSliderValue(setting, this.settings[setting]);
		const sliderEl = document.createElement("input");
		sliderEl.id = inputId;
		sliderEl.classList.add("draw-in-canvas-stroke-width-slider", "draw-in-canvas-freehand-slider");
		sliderEl.type = "range";
		sliderEl.min = slider.min.toString();
		sliderEl.max = slider.max.toString();
		sliderEl.step = slider.step.toString();
		sliderEl.value = value.toString();
		sliderEl.dataset.freehandSetting = setting;
		sliderEl.setAttribute("aria-label", slider.ariaLabel);
		sliderEl.disabled = !this.settings.beautifulStrokes;

		this.strokeSettingsPaletteDisposers.push(
			this.addListener(sliderEl, "input", this.handleFreehandSliderInput),
		);

		const valueClassName = "draw-in-canvas-stroke-width-value";
		const controlEl = createSliderControlEl(
			inputId,
			slider.label,
			valueClassName,
			formatFreehandSliderValue(setting, value),
			sliderEl,
		);
		controlEl.classList.add("draw-in-canvas-freehand-control");
		controlEl.querySelector("output")?.setAttribute("data-freehand-value", setting);
		return controlEl;
	}

	private setStrokeWidth(width: number): void {
		const strokeWidth = normalizeStrokeWidth(width);

		if (strokeWidth === normalizeStrokeWidth(this.settings.strokeWidth)) {
			return;
		}

		this.settings = {...this.settings, strokeWidth};
		this.requestSetStrokeWidth(strokeWidth);
		this.syncBrushControls();
	}

	private setStrokeHardness(hardness: number): void {
		const strokeHardness = normalizeStrokeHardness(hardness);

		if (strokeHardness === normalizeStrokeHardness(this.settings.strokeHardness)) {
			return;
		}

		this.settings = {...this.settings, strokeHardness};
		this.requestSetStrokeHardness(strokeHardness);
		this.syncStrokeSettingsPaletteControls();
	}

	private setStrokeOpacity(opacity: number): void {
		const strokeOpacity = normalizeStrokeOpacity(opacity);

		if (strokeOpacity === normalizeStrokeOpacity(this.settings.strokeOpacity)) {
			return;
		}

		this.settings = {...this.settings, strokeOpacity};
		this.requestSetStrokeOpacity(strokeOpacity);
		this.syncBrushControls();
	}

	private setFreehandSliderValue(setting: FreehandSliderSetting, value: number): void {
		const nextValue = normalizeFreehandSliderValue(setting, value);

		if (nextValue === normalizeFreehandSliderValue(setting, this.settings[setting])) {
			return;
		}

		this.requestSetFreehandSliderValue(setting, nextValue);
		this.settings = {...this.settings, [setting]: nextValue};
		this.syncStrokeSettingsPaletteControls();
	}

	private resetFreehandSliderValues(): void {
		let nextSettings = this.settings;

		for (const setting of getFreehandSliderSettingKeys()) {
			const defaultValue = FREEHAND_SLIDER_SETTINGS[setting].defaultValue;

			if (normalizeFreehandSliderValue(setting, nextSettings[setting]) === defaultValue) {
				continue;
			}

			nextSettings = {...nextSettings, [setting]: defaultValue};
			this.requestSetFreehandSliderValue(setting, defaultValue);
		}

		this.settings = nextSettings;
		this.syncStrokeSettingsPaletteControls();
	}

	private setBeautifulStrokes(enabled: boolean): void {
		if (enabled === this.settings.beautifulStrokes) {
			return;
		}

		this.settings = {...this.settings, beautifulStrokes: enabled};
		this.requestSetBeautifulStrokes(enabled);
		this.syncStrokeSettingsPaletteControls();
	}

	private openBrushPreview(event: PointerEvent, triggerEl: HTMLElement, setting: BrushSliderSetting): void {
		this.closeBrushPreview();
		this.brushPreviewState = {
			pointerId: event.pointerId,
			triggerEl,
			setting,
			x: event.clientX,
			y: event.clientY,
		};

		trySetPointerCapture(triggerEl, event.pointerId);
		this.brushPreviewDisposers.push(
			this.addListener(document, "pointermove", this.handleBrushPreviewPointerMove, true),
			this.addListener(document, "pointerup", this.handleBrushPreviewPointerUp, true),
			this.addListener(document, "pointercancel", this.handleBrushPreviewPointerUp, true),
			this.addListener(window, "blur", this.handleBrushPreviewWindowBlur),
		);

		this.positionBrushPreview(event.clientX, event.clientY);
		this.updateBrushPreview(setting);
	}

	private closeBrushPreview(): void {
		for (const dispose of this.brushPreviewDisposers.splice(0)) {
			dispose();
		}

		const state = this.brushPreviewState;

		if (state?.triggerEl.hasPointerCapture(state.pointerId)) {
			state.triggerEl.releasePointerCapture(state.pointerId);
		}

		this.brushPreviewEl?.remove();
		this.brushPreviewEl = null;
		this.brushPreviewState = null;
	}

	private positionBrushPreview(x: number, y: number): void {
		const previewEl = this.ensureBrushPreviewEl();
		const state = this.brushPreviewState;

		if (state) {
			state.x = x;
			state.y = y;
		}

		const previewRect = previewEl.getBoundingClientRect();
		const margin = 8;
		const gap = 18;
		const previewWidth = previewRect.width || 96;
		const previewHeight = previewRect.height || 56;
		const left = Math.max(margin, Math.min(x + gap, window.innerWidth - previewWidth - margin));
		const top = Math.max(margin, Math.min(y - previewHeight / 2, window.innerHeight - previewHeight - margin));

		previewEl.setCssStyles({
			left: `${left}px`,
			top: `${top}px`,
		});
	}

	private updateBrushPreview(activeSetting = this.brushPreviewState?.setting ?? "size"): void {
		const state = this.brushPreviewState;

		if (!state) {
			return;
		}

		const strokeWidth = normalizeStrokeWidth(this.settings.strokeWidth);
		const strokeOpacity = normalizeStrokeOpacity(this.settings.strokeOpacity);
		const previewEl = this.ensureBrushPreviewEl();
		const valueEl = previewEl.querySelector<HTMLElement>(".draw-in-canvas-brush-preview-value");
		const detailEl = previewEl.querySelector<HTMLElement>(".draw-in-canvas-brush-preview-detail");

		previewEl.dataset.brushPreviewSetting = activeSetting;
		previewEl.setCssProps({
			"--draw-in-canvas-brush-preview-size": `${Math.max(4, strokeWidth)}px`,
			"--draw-in-canvas-brush-preview-color": this.settings.strokeColor,
			"--draw-in-canvas-brush-preview-opacity": formatStrokeOpacityRatio(strokeOpacity),
		});

		if (valueEl) {
			valueEl.textContent = activeSetting === "opacity" ? formatStrokeOpacity(strokeOpacity) : formatStrokeWidth(strokeWidth);
		}

		if (detailEl) {
			detailEl.textContent = activeSetting === "opacity"
				? `${formatStrokeWidth(strokeWidth)} brush`
				: `${formatStrokeOpacity(strokeOpacity)} opacity`;
		}

		this.positionBrushPreview(state.x, state.y);
	}

	private ensureBrushPreviewEl(): HTMLElement {
		if (this.brushPreviewEl?.isConnected) {
			return this.brushPreviewEl;
		}

		const previewEl = document.createElement("div");
		previewEl.classList.add("draw-in-canvas-brush-preview");
		previewEl.setAttribute("aria-hidden", "true");

		const sampleEl = document.createElement("span");
		sampleEl.classList.add("draw-in-canvas-brush-preview-sample");

		const dotEl = document.createElement("span");
		dotEl.classList.add("draw-in-canvas-brush-preview-dot");
		sampleEl.appendChild(dotEl);

		const textEl = document.createElement("span");
		textEl.classList.add("draw-in-canvas-brush-preview-text");

		const valueEl = document.createElement("span");
		valueEl.classList.add("draw-in-canvas-brush-preview-value");

		const detailEl = document.createElement("span");
		detailEl.classList.add("draw-in-canvas-brush-preview-detail");

		textEl.append(valueEl, detailEl);
		previewEl.append(sampleEl, textEl);
		document.body.appendChild(previewEl);
		this.brushPreviewEl = previewEl;
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
			if (this.isDrawingEnabled()) {
				this.mountBrushControls();
			}
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

	private createPathEl(stroke: CanvasStroke, isComplete = true): SVGPathElement {
		const pathEl = document.createElementNS(SVG_NS, "path");
		pathEl.classList.add("draw-in-canvas-stroke");
		this.updateVisibleStrokePathEl(pathEl, stroke, isComplete);
		return pathEl;
	}

	private updateVisibleStrokePathEl(
		pathEl: SVGPathElement,
		stroke: CanvasStroke,
		isComplete = true,
		options: StrokeRenderOptions = {},
	): void {
		const hasPressure = options.hasPressure ?? strokeHasPressure(stroke);
		const shouldUseHandwrittenPath = this.shouldUseHandwrittenStrokePath(stroke, hasPressure);
		pathEl.classList.toggle("mod-handwritten", shouldUseHandwrittenPath);
		pathEl.setAttribute("pointer-events", "none");
		pathEl.setAttribute("opacity", formatStrokeOpacityRatio(stroke.opacity));
		this.applyStrokeHardness(pathEl, stroke);

		if (shouldUseHandwrittenPath) {
			pathEl.setAttribute("d", this.getHandwrittenStrokeShapePath(stroke, isComplete, hasPressure, options));
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

	private applyStrokeHardness(pathEl: SVGPathElement, stroke: CanvasStroke): void {
		const blurRadius = getStrokeHardnessBlurRadius(stroke);
		pathEl.classList.toggle("mod-soft-edge", blurRadius > 0);
		pathEl.setCssStyles({filter: blurRadius > 0 ? `blur(${blurRadius}px)` : ""});
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


	private shouldUseHandwrittenStrokePath(stroke: CanvasStroke, hasPressure = strokeHasPressure(stroke)): boolean {
		return this.settings.beautifulStrokes || hasPressure;
	}

	private getStrokeCenterPath(stroke: CanvasStroke): string {
		return pointsToSvgPath(stroke.points, {smooth: this.settings.beautifulStrokes});
	}

	private getHandwrittenStrokeShapePath(
		stroke: CanvasStroke,
		isComplete: boolean,
		hasPressure = strokeHasPressure(stroke),
		options: StrokeRenderOptions = {},
	): string {
		const isStart = options.isStart ?? true;
		const isEnd = options.isEnd ?? true;
		const outlinePoints = getStroke(stroke.points, {
			size: stroke.width,
			thinning: this.settings.strokeThinning,
			streamline: this.settings.strokeStreamline,
			smoothing: this.settings.strokeSmoothing,
			simulatePressure: !hasPressure,
			start: {
				cap: isStart && this.settings.strokeTaperStart === 0,
				taper: isStart ? this.settings.strokeTaperStart : 0,
			},
			end: {
				cap: isEnd && this.settings.strokeTaperEnd === 0,
				taper: isEnd ? this.settings.strokeTaperEnd : 0,
			},
			last: isComplete && isEnd,
		});

		return getSvgPathFromStroke(outlinePoints);
	}

	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || !this.captureEl) {
			return;
		}

		if (this.isSpaceKeyPressed) {
			this.hidePenCursor();
			return;
		}

		this.showPenCursorFromEvent(event);
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
			hardness: this.settings.strokeHardness,
			opacity: this.settings.strokeOpacity,
			points: [point],
			createdAt: Date.now(),
		};

		const strokeGroupEl = document.createElementNS(SVG_NS, "g");
		strokeGroupEl.classList.add("draw-in-canvas-active-stroke");
		strokeGroupEl.setAttribute("pointer-events", "none");
		const activeStrokePathEl = this.createPathEl(stroke, false);
		strokeGroupEl.appendChild(activeStrokePathEl);

		this.activeStroke = stroke;
		this.activeStrokeGroupEl = strokeGroupEl;
		this.activeStrokePathEl = activeStrokePathEl;
		this.activeStrokePointerId = event.pointerId;
		this.activeStrokeHasPressure = point.pressure !== undefined;
		this.initializeActiveStrokePreviewState();
		this.addStroke(stroke);
		this.svgEl.appendChild(strokeGroupEl);
	};

	private readonly handlePointerMove = (event: PointerEvent): void => {
		this.showPenCursorFromEvent(event);

		if (!this.activeStroke || !this.activeStrokeGroupEl || event.pointerId !== this.activeStrokePointerId) {
			return;
		}

		if (!this.appendActiveStrokePointerPoints(event)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.scheduleActiveStrokePreviewUpdate();
	};

	private readonly handlePointerUp = (event: PointerEvent): void => {
		if (!this.activeStroke || event.pointerId !== this.activeStrokePointerId) {
			if (event.type === "pointercancel") {
				this.hidePenCursor();
			}

			return;
		}

		this.appendActiveStrokePointerPoints(event);

		event.preventDefault();
		event.stopPropagation();

		if (this.captureEl?.hasPointerCapture(event.pointerId)) {
			this.captureEl.releasePointerCapture(event.pointerId);
		}

		this.finishActiveStroke();
		this.updatePenCursorAfterPointerEnd(event);
	};

	private readonly handlePointerLeave = (event: PointerEvent): void => {
		if (!isPenPointerEvent(event)) {
			return;
		}

		if (this.activeStroke && event.pointerId === this.activeStrokePointerId) {
			return;
		}

		this.hidePenCursor();
	};

	private readonly handleCaptureWindowBlur = (): void => {
		this.hidePenCursor();
	};

	private showPenCursorFromEvent(event: PointerEvent): void {
		if (!this.settings.usePenCursorFallback || !isPenPointerEvent(event) || !this.captureEl || this.isSpaceKeyPressed) {
			this.hidePenCursor();
			return;
		}

		const cursorEl = this.ensurePenCursorEl();
		cursorEl.classList.add("is-visible");
		this.captureEl.classList.add("is-pen-cursor-active");
		this.pendingPenCursorPosition = {x: event.clientX, y: event.clientY};
		this.schedulePenCursorUpdate();
	}

	private updatePenCursorAfterPointerEnd(event: PointerEvent): void {
		if (!isPenPointerEvent(event)) {
			return;
		}

		if (event.type === "pointercancel" || !this.captureEl || !isPointerEventInsideElement(event, this.captureEl)) {
			this.hidePenCursor();
			return;
		}

		this.showPenCursorFromEvent(event);
	}

	private ensurePenCursorEl(): HTMLElement {
		if (this.penCursorEl?.isConnected) {
			return this.penCursorEl;
		}

		const cursorEl = document.createElement("div");
		cursorEl.classList.add("draw-in-canvas-pen-cursor");
		cursorEl.setAttribute("aria-hidden", "true");
		document.body.appendChild(cursorEl);
		this.penCursorEl = cursorEl;
		this.penCursorAppearanceKey = "";
		return cursorEl;
	}

	private schedulePenCursorUpdate(): void {
		if (this.penCursorFrameId !== null) {
			return;
		}

		this.penCursorFrameId = window.requestAnimationFrame(() => {
			this.penCursorFrameId = null;
			this.updatePenCursorFromPendingPosition();
		});
	}

	private updatePenCursorFromPendingPosition(): void {
		if (!this.penCursorEl || !this.pendingPenCursorPosition) {
			return;
		}

		this.syncPenCursorAppearance(this.penCursorEl);
		this.penCursorEl.setCssStyles({
			transform: `translate3d(${this.pendingPenCursorPosition.x}px, ${this.pendingPenCursorPosition.y}px, 0) translate(-50%, -50%)`,
		});
	}

	private syncPenCursorAppearance(cursorEl: HTMLElement): void {
		const color = this.settings.strokeColor;
		const size = `${this.getPenCursorDiameter()}px`;
		const appearanceKey = `${color}|${size}`;

		if (appearanceKey === this.penCursorAppearanceKey) {
			return;
		}

		cursorEl.setCssProps({
			"--draw-in-canvas-current-color": color,
			"--draw-in-canvas-pen-cursor-size": size,
		});
		this.penCursorAppearanceKey = appearanceKey;
	}

	private hidePenCursor(): void {
		this.cancelPenCursorUpdate();
		this.pendingPenCursorPosition = null;
		this.penCursorEl?.classList.remove("is-visible");
		this.captureEl?.classList.remove("is-pen-cursor-active");
	}

	private removePenCursor(): void {
		this.hidePenCursor();
		this.penCursorEl?.remove();
		this.penCursorEl = null;
		this.penCursorAppearanceKey = "";
	}

	private cancelPenCursorUpdate(): void {
		if (this.penCursorFrameId === null) {
			return;
		}

		window.cancelAnimationFrame(this.penCursorFrameId);
		this.penCursorFrameId = null;
	}

	private getPenCursorDiameter(): number {
		const matrix = this.svgEl?.getScreenCTM();
		const screenScale = matrix ? getSvgScreenScale(matrix) : 1;
		const diameter = normalizeStrokeWidth(this.settings.strokeWidth) * screenScale;
		return Math.round(Math.min(96, Math.max(8, diameter)));
	}

	private appendActiveStrokePointerPoints(event: PointerEvent): boolean {
		const activeStroke = this.activeStroke;

		if (!activeStroke) {
			return false;
		}

		const toCanvasPoint = this.createCanvasPointMapper();

		if (!toCanvasPoint) {
			return false;
		}

		let didAppendPoint = false;
		const appendPointerEventPoint = (pointerEvent: PointerEvent): void => {
			const point = toCanvasPoint(pointerEvent);
			const previousPoint = activeStroke.points[activeStroke.points.length - 1];

			if (!previousPoint || distanceBetween(previousPoint, point) < MIN_POINT_DISTANCE) {
				return;
			}

			activeStroke.points.push(point);
			if (point.pressure !== undefined) {
				this.activeStrokeHasPressure = true;
			}
			didAppendPoint = true;
		};
		const coalescedEvents = getCoalescedPointerEvents(event);

		for (const pointerEvent of coalescedEvents) {
			appendPointerEventPoint(pointerEvent);
		}

		if (coalescedEvents.length === 0 || coalescedEvents[coalescedEvents.length - 1] !== event) {
			appendPointerEventPoint(event);
		}

		return didAppendPoint;
	}

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

		const hasPressure = this.activeStrokeHasPressure;

		if (this.shouldUseHandwrittenStrokePath(this.activeStroke, hasPressure)) {
			this.updateHandwrittenActiveStrokePreview(this.activeStroke, hasPressure);
			return;
		}

		this.updateLinearActiveStrokePreview(this.activeStroke);
	}

	private initializeActiveStrokePreviewState(): void {
		this.resetActiveStrokePreviewState();
	}

	private resetActiveStrokePreviewState(): void {
		for (const pathEl of this.activeStrokePreviewChunkPathEls.splice(0)) {
			pathEl.remove();
		}

		this.activeStrokePreviewCommittedPointIndex = 0;
	}

	private updateLinearActiveStrokePreview(stroke: CanvasStroke): void {
		if (!this.activeStrokePathEl) {
			return;
		}

		this.flushLinearActiveStrokePreviewChunks(stroke);

		const tailStartIndex = Math.max(0, this.activeStrokePreviewCommittedPointIndex - 1);
		const tailStroke = getStrokePointSubset(stroke, tailStartIndex, stroke.points.length);
		this.updateLinearStrokePathEl(this.activeStrokePathEl, tailStroke);
	}

	private flushLinearActiveStrokePreviewChunks(stroke: CanvasStroke): void {
		if (!this.activeStrokeGroupEl || !this.activeStrokePathEl) {
			return;
		}

		while (stroke.points.length - this.activeStrokePreviewCommittedPointIndex > ACTIVE_STROKE_PREVIEW_WINDOW_SIZE + ACTIVE_STROKE_PREVIEW_CHUNK_SIZE) {
			const chunkStartIndex = this.activeStrokePreviewCommittedPointIndex;
			const chunkEndIndex = Math.min(chunkStartIndex + ACTIVE_STROKE_PREVIEW_CHUNK_SIZE, stroke.points.length);

			if (chunkEndIndex - chunkStartIndex < 2) {
				return;
			}

			const chunkStroke = getStrokePointSubset(stroke, chunkStartIndex, chunkEndIndex);
			const chunkPathEl = document.createElementNS(SVG_NS, "path");
			chunkPathEl.classList.add("draw-in-canvas-stroke");
			this.updateLinearStrokePathEl(chunkPathEl, chunkStroke);

			this.activeStrokeGroupEl.insertBefore(chunkPathEl, this.activeStrokePathEl);
			this.activeStrokePreviewChunkPathEls.push(chunkPathEl);
			this.activeStrokePreviewCommittedPointIndex = chunkEndIndex;
		}
	}

	private updateLinearStrokePathEl(pathEl: SVGPathElement, stroke: CanvasStroke): void {
		pathEl.classList.remove("mod-handwritten");
		pathEl.setAttribute("pointer-events", "none");
		pathEl.setAttribute("opacity", formatStrokeOpacityRatio(stroke.opacity));
		this.applyStrokeHardness(pathEl, stroke);
		pathEl.setAttribute("d", this.getStrokeCenterPath(stroke));
		pathEl.setAttribute("stroke", stroke.color);
		pathEl.setAttribute("stroke-width", stroke.width.toString());
		pathEl.setAttribute("fill", "none");
		pathEl.setAttribute("stroke-linecap", "round");
		pathEl.setAttribute("stroke-linejoin", "round");
	}

	private updateHandwrittenActiveStrokePreview(stroke: CanvasStroke, hasPressure: boolean): void {
		if (!this.activeStrokePathEl) {
			return;
		}

		this.flushActiveStrokePreviewChunks(stroke, hasPressure);

		const tailStartIndex = Math.max(0, this.activeStrokePreviewCommittedPointIndex - ACTIVE_STROKE_PREVIEW_OVERLAP);
		const tailStroke = getStrokePointSubset(stroke, tailStartIndex, stroke.points.length);
		this.updateVisibleStrokePathEl(this.activeStrokePathEl, tailStroke, false, {
			hasPressure,
			isStart: tailStartIndex === 0,
			isEnd: true,
		});
	}

	private flushActiveStrokePreviewChunks(stroke: CanvasStroke, hasPressure: boolean): void {
		if (!this.activeStrokeGroupEl || !this.activeStrokePathEl) {
			return;
		}

		while (stroke.points.length - this.activeStrokePreviewCommittedPointIndex > ACTIVE_STROKE_PREVIEW_WINDOW_SIZE + ACTIVE_STROKE_PREVIEW_CHUNK_SIZE) {
			const chunkStartIndex = this.activeStrokePreviewCommittedPointIndex;
			const chunkEndIndex = Math.min(chunkStartIndex + ACTIVE_STROKE_PREVIEW_CHUNK_SIZE, stroke.points.length);

			if (chunkEndIndex - chunkStartIndex < 2) {
				return;
			}

			const chunkStroke = getStrokePointSubset(stroke, chunkStartIndex, chunkEndIndex);
			const chunkPathEl = document.createElementNS(SVG_NS, "path");
			chunkPathEl.classList.add("draw-in-canvas-stroke");
			this.updateVisibleStrokePathEl(chunkPathEl, chunkStroke, false, {
				hasPressure,
				isStart: chunkStartIndex === 0,
				isEnd: false,
			});

			this.activeStrokeGroupEl.insertBefore(chunkPathEl, this.activeStrokePathEl);
			this.activeStrokePreviewChunkPathEls.push(chunkPathEl);
			this.activeStrokePreviewCommittedPointIndex = chunkEndIndex;
		}
	}

	private cancelActiveStrokePreviewUpdate(): void {
		if (this.activeStrokePreviewFrameId === null) {
			return;
		}

		window.cancelAnimationFrame(this.activeStrokePreviewFrameId);
		this.activeStrokePreviewFrameId = null;
	}

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		if (this.shouldUseSelectToolShortcut(event)) {
			event.preventDefault();
			event.stopPropagation();
			this.enableSelectMode();
			return;
		}

		if (event.key !== "Escape") {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.requestToggleDrawingMode();
	};

	private readonly handleSelectToolbarPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || !this.selectButtonEl) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.selectButtonEl.focus({preventScroll: true});
		this.enableSelectMode();
	};

	private readonly handleSelectToolbarKeyDown = (event: KeyboardEvent): void => {
		if (!isActivationKey(event)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.enableSelectMode();
	};

	private enableSelectMode(): void {
		this.closeBrushPopovers();
		this.clearToolbarPressState();

		if (this.isDrawingEnabled()) {
			this.disableDrawingMode();
			return;
		}

		this.syncToolbarButton();
	}

	private shouldUseSelectToolShortcut(event: KeyboardEvent): boolean {
		if (!this.captureEl || !isSelectToolShortcutEvent(event) || isEditableEventTarget(event.target)) {
			return false;
		}

		if (event.target instanceof Node && (this.colorPaletteEl?.contains(event.target) || this.strokeSettingsPaletteEl?.contains(event.target) || this.brushControlsEl?.contains(event.target))) {
			return false;
		}

		return this.app.workspace.getMostRecentLeaf() === this.target.leaf;
	}

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
			this.closeBrushPopovers();
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
		this.closeBrushPopovers();
		this.requestToggleDrawingMode();
	};

	private readonly handleColorSwatchPointerDown = (event: PointerEvent): void => {
		event.preventDefault();
		event.stopPropagation();
	};

	private readonly handlePresetColorSwatchClick = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLElement)) {
			return;
		}

		const color = event.currentTarget.dataset.color;

		if (!color) {
			return;
		}

		this.setStrokeColor(color);
	};

	private readonly handleColorPaletteTabClick = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLElement)) {
			return;
		}

		const tab = getColorPaletteTab(event.currentTarget.dataset.colorPaletteTab);

		if (!tab) {
			return;
		}

		this.colorPaletteTab = tab;
		this.syncColorPaletteTabControls();
		this.positionColorPalette();
	};

	private readonly handleColorPaletteTabKeyDown = (event: KeyboardEvent): void => {
		if (!(event.currentTarget instanceof HTMLElement)) {
			return;
		}

		const currentTab = getColorPaletteTab(event.currentTarget.dataset.colorPaletteTab);

		if (!currentTab) {
			return;
		}

		const nextTab = getColorPaletteTabFromKey(currentTab, event);

		if (!nextTab) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.colorPaletteTab = nextTab;
		this.syncColorPaletteTabControls();
		this.positionColorPalette();
		this.colorPaletteEl
			?.querySelector<HTMLElement>(`[data-color-palette-tab="${nextTab}"]`)
			?.focus({preventScroll: true});
	};

	private readonly handleColorWheelPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) {
			return;
		}

		const control = getColorWheelControl(event.currentTarget.dataset.colorWheelControl);

		if (!control) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus({preventScroll: true});
		trySetPointerCapture(event.currentTarget, event.pointerId);
		this.updateColorWheelFromPointer(event.currentTarget, event, control);
	};

	private readonly handleColorWheelPointerMove = (event: PointerEvent): void => {
		if (!(event.currentTarget instanceof HTMLElement) || !event.currentTarget.hasPointerCapture(event.pointerId)) {
			return;
		}

		const control = getColorWheelControl(event.currentTarget.dataset.colorWheelControl);

		if (!control) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.updateColorWheelFromPointer(event.currentTarget, event, control);
	};

	private readonly handleColorWheelPointerUp = (event: PointerEvent): void => {
		if (!(event.currentTarget instanceof HTMLElement) || !event.currentTarget.hasPointerCapture(event.pointerId)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
	};

	private readonly handleColorWheelKeyDown = (event: KeyboardEvent): void => {
		if (!(event.currentTarget instanceof HTMLElement)) {
			return;
		}

		const control = getColorWheelControl(event.currentTarget.dataset.colorWheelControl);
		const nextColor = control === "hue"
			? getColorWheelHueKeyboardColor(this.colorWheelHsv, event)
			: control === "disc"
				? getColorWheelDiscKeyboardColor(this.colorWheelHsv, event)
				: null;

		if (!nextColor) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.setColorWheelHsv(nextColor);
	};

	private updateColorWheelFromPointer(controlEl: HTMLElement, event: PointerEvent, control: ColorWheelControl): void {
		const nextColor = control === "hue"
			? {...this.colorWheelHsv, h: getColorWheelHueFromPointer(controlEl, event.clientX, event.clientY)}
			: {...this.colorWheelHsv, ...getColorWheelDiscValuesFromPointer(controlEl, event.clientX, event.clientY)};

		this.setColorWheelHsv(nextColor);
	}

	private readonly handleNativeColorPickerInput = (event: Event): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		const hexColor = normalizeHexColor(event.currentTarget.value);

		if (!hexColor) {
			return;
		}

		this.customColorHex = hexColor;
		this.setStrokeColor(hexColor);
	};

	private readonly handleCustomColorHexPointerDown = (event: PointerEvent): void => {
		event.stopPropagation();

		if (event.currentTarget instanceof HTMLInputElement) {
			this.shouldSelectCustomColorHexOnClick = document.activeElement !== event.currentTarget;
		}
	};

	private readonly handleCustomColorHexClick = (event: MouseEvent): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		if (this.shouldSelectCustomColorHexOnClick) {
			event.currentTarget.select();
			this.shouldSelectCustomColorHexOnClick = false;
		}
	};

	private readonly handleCustomColorHexFocus = (event: FocusEvent): void => {
		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		const inputEl = event.currentTarget;

		window.requestAnimationFrame(() => {
			if (document.activeElement === inputEl) {
				inputEl.select();
			}
		});
	};

	private readonly handleCustomColorHexInput = (event: Event): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		const hexColor = normalizeHexColor(event.currentTarget.value);
		const isEmpty = event.currentTarget.value.trim().length === 0;
		setHexInputValidity(event.currentTarget, Boolean(hexColor) || isEmpty);

		if (!hexColor) {
			return;
		}

		this.customColorHex = hexColor;
		this.setStrokeColor(hexColor);
	};

	private readonly handleCustomColorHexChange = (event: Event): void => {
		event.stopPropagation();
		this.shouldSelectCustomColorHexOnClick = false;

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		const hexColor = normalizeHexColor(event.currentTarget.value);

		if (hexColor) {
			this.customColorHex = hexColor;
			this.setStrokeColor(hexColor);
		}

		event.currentTarget.value = formatHexColor(this.customColorHex);
		setHexInputValidity(event.currentTarget, true);
	};

	private readonly handleCustomColorHexKeyDown = (event: KeyboardEvent): void => {
		event.stopPropagation();

		if (event.key !== "Enter" || !(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		event.preventDefault();
		event.currentTarget.blur();
	};

	private readonly handleCustomColorShadeClick = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLElement)) {
			return;
		}

		const color = event.currentTarget.dataset.color;

		if (!color) {
			return;
		}

		this.setStrokeColor(color);
	};

	private readonly handleStrokeWidthSliderPointerDown = (event: PointerEvent): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		event.currentTarget.focus({preventScroll: true});
		this.openBrushPreview(event, event.currentTarget, "size");
	};

	private readonly handleBrushSliderPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) {
			return;
		}

		const setting = getBrushSliderSetting(event.currentTarget.dataset.brushSlider);

		if (!setting) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus({preventScroll: true});
		this.openBrushPreview(event, event.currentTarget, setting);
		this.updateBrushSliderFromPointer(event.currentTarget, event);
	};

	private readonly handleBrushSliderPointerMove = (event: PointerEvent): void => {
		if (!(event.currentTarget instanceof HTMLElement) || !event.currentTarget.hasPointerCapture(event.pointerId)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.updateBrushSliderFromPointer(event.currentTarget, event);
	};

	private readonly handleBrushSliderPointerUp = (event: PointerEvent): void => {
		if (!(event.currentTarget instanceof HTMLElement)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.closeBrushPreview();
	};

	private readonly handleBrushSliderKeyDown = (event: KeyboardEvent): void => {
		if (!(event.currentTarget instanceof HTMLElement)) {
			return;
		}

		const setting = getBrushSliderSetting(event.currentTarget.dataset.brushSlider);

		if (!setting) {
			return;
		}

		const nextValue = getBrushSliderKeyboardValue(setting, event, this.getBrushSliderCurrentValue(setting));

		if (nextValue === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.setBrushSliderValue(setting, nextValue);
	};

	private readonly handleBrushButtonPointerDown = (event: PointerEvent): void => {
		event.stopPropagation();
	};

	private readonly handleBrushButtonKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Tab") {
			event.stopPropagation();
		}
	};

	private readonly handleBrushColorButtonClick = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		this.openColorPalette();
	};

	private readonly handleBrushSettingsButtonClick = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		this.openStrokeSettingsPalette();
	};

	private updateBrushSliderFromPointer(sliderEl: HTMLElement, event: PointerEvent): void {
		const setting = getBrushSliderSetting(sliderEl.dataset.brushSlider);

		if (!setting) {
			return;
		}

		this.setBrushSliderValue(setting, getBrushSliderValueFromPointer(setting, sliderEl, event.clientY));
	}

	private getBrushSliderCurrentValue(setting: BrushSliderSetting): number {
		return setting === "size"
			? normalizeStrokeWidth(this.settings.strokeWidth)
			: normalizeStrokeOpacity(this.settings.strokeOpacity);
	}

	private setBrushSliderValue(setting: BrushSliderSetting, value: number): void {
		if (setting === "size") {
			const strokeWidth = normalizeStrokeWidth(value);
			this.setStrokeWidth(strokeWidth);
			this.updateBrushPreview("size");
			return;
		}

		const strokeOpacity = normalizeStrokeOpacity(value);
		this.setStrokeOpacity(strokeOpacity);
		this.updateBrushPreview("opacity");
	}

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
		this.updateBrushPreview("size");
	};

	private readonly handleStrokeHardnessSliderInput = (event: Event): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		this.setStrokeHardness(Number(event.currentTarget.value));
	};

	private readonly handleStrokeOpacitySliderInput = (event: Event): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		this.setStrokeOpacity(Number(event.currentTarget.value));
		this.updateBrushPreview("opacity");
	};

	private readonly handleFreehandSliderInput = (event: Event): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		const setting = getFreehandSliderSetting(event.currentTarget.dataset.freehandSetting);

		if (!setting) {
			return;
		}

		this.setFreehandSliderValue(setting, Number(event.currentTarget.value));
	};

	private readonly handleHandwritingToggleChange = (event: Event): void => {
		event.stopPropagation();

		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return;
		}

		this.setBeautifulStrokes(event.currentTarget.checked);
	};

	private readonly handleFreehandResetClick = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		this.resetFreehandSliderValues();
	};

	private readonly handleBrushPreviewPointerMove = (event: PointerEvent): void => {
		const state = this.brushPreviewState;

		if (!state || state.pointerId !== event.pointerId) {
			return;
		}

		this.positionBrushPreview(event.clientX, event.clientY);
		this.updateBrushPreview(state.setting);
	};

	private readonly handleBrushPreviewPointerUp = (event: PointerEvent): void => {
		const state = this.brushPreviewState;

		if (!state || state.pointerId !== event.pointerId) {
			return;
		}

		this.closeBrushPreview();
	};

	private readonly handleBrushPreviewWindowBlur = (): void => {
		this.closeBrushPreview();
	};

	private readonly handleBrushPopoverDocumentPointerDown = (event: PointerEvent): void => {
		const target = event.target;

		if (target instanceof Node && (this.toolbarGroupEl?.contains(target) || this.colorPaletteEl?.contains(target) || this.strokeSettingsPaletteEl?.contains(target) || this.brushControlsEl?.contains(target))) {
			return;
		}

		this.closeBrushPopovers();
	};

	private readonly handleColorPaletteDocumentKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const focusTargetEl = this.colorPaletteTriggerEl ?? this.brushColorButtonEl ?? this.toolbarButtonEl;
		this.closeColorPalette();
		focusTargetEl?.focus({preventScroll: true});
	};

	private readonly handleStrokeSettingsPaletteDocumentKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const focusTargetEl = this.strokeSettingsPaletteTriggerEl ?? this.brushSettingsButtonEl;
		this.closeStrokeSettingsPalette();
		focusTargetEl?.focus({preventScroll: true});
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
		if (this.shouldUseSelectToolShortcut(event)) {
			event.preventDefault();
			event.stopPropagation();
			this.enableSelectMode();
			return;
		}

		if (event.target instanceof Node && this.brushControlsEl?.contains(event.target)) {
			return;
		}

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
			const dotEndPoint: StrokePoint = {
				x: roundCoordinate(firstPoint.x + 0.01),
				y: roundCoordinate(firstPoint.y + 0.01),
			};

			if (firstPoint.pressure !== undefined) {
				dotEndPoint.pressure = firstPoint.pressure;
			}

			completedStroke.points.push(dotEndPoint);
		}

		this.setStrokeBounds(completedStroke);
		this.activeStrokeGroupEl?.replaceWith(this.createStrokeGroupEl(completedStroke));
		this.activeStroke = null;
		this.activeStrokeGroupEl = null;
		this.activeStrokePathEl = null;
		this.activeStrokePointerId = null;
		this.activeStrokeHasPressure = false;
		this.resetActiveStrokePreviewState();
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
		return this.createCanvasPointMapper()?.(event) ?? null;
	}

	private createCanvasPointMapper(): CanvasPointMapper | null {
		if (!this.svgEl) {
			return null;
		}

		const matrix = this.svgEl.getScreenCTM();

		if (matrix) {
			const inverseMatrix = matrix.inverse();
			const point = this.svgEl.createSVGPoint();

			return (event: PointerEvent) => {
				point.x = event.clientX;
				point.y = event.clientY;
				const canvasPoint = point.matrixTransform(inverseMatrix);
				return createStrokePoint(canvasPoint.x, canvasPoint.y, event);
			};
		}

		const rect = this.svgEl.getBoundingClientRect();
		return (event: PointerEvent) => createStrokePoint(event.clientX - rect.left, event.clientY - rect.top, event);
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

		if (this.strokeSettingsPaletteEl) {
			ownedElements.add(this.strokeSettingsPaletteEl);
		}

		if (this.brushControlsEl) {
			ownedElements.add(this.brushControlsEl);
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

function getSvgPathFromStroke(points: readonly [number, number][], closed = true): string {
	const pointCount = points.length;

	if (pointCount < 4) {
		return "";
	}

	let firstPoint = points[0];
	let controlPoint = points[1];
	const nextPoint = points[2];

	if (!firstPoint || !controlPoint || !nextPoint) {
		return "";
	}

	let path = `M${formatSvgNumber(firstPoint[0])},${formatSvgNumber(firstPoint[1])} Q${formatSvgNumber(controlPoint[0])},${formatSvgNumber(controlPoint[1])} ${formatSvgNumber(average(controlPoint[0], nextPoint[0]))},${formatSvgNumber(average(controlPoint[1], nextPoint[1]))} T`;

	for (let index = 2, max = pointCount - 1; index < max; index++) {
		firstPoint = points[index];
		controlPoint = points[index + 1];

		if (!firstPoint || !controlPoint) {
			continue;
		}

		path += `${formatSvgNumber(average(firstPoint[0], controlPoint[0]))},${formatSvgNumber(average(firstPoint[1], controlPoint[1]))} `;
	}

	return closed ? `${path}Z` : path;
}

function average(a: number, b: number): number {
	return (a + b) / 2;
}

function formatSvgNumber(value: number): string {
	return roundCoordinate(value).toString();
}

function shouldRerenderForSettingsChange(previousSettings: DrawInCanvasSettings, nextSettings: DrawInCanvasSettings): boolean {
	return previousSettings.beautifulStrokes !== nextSettings.beautifulStrokes
		|| previousSettings.strokeThinning !== nextSettings.strokeThinning
		|| previousSettings.strokeStreamline !== nextSettings.strokeStreamline
		|| previousSettings.strokeSmoothing !== nextSettings.strokeSmoothing
		|| previousSettings.strokeTaperStart !== nextSettings.strokeTaperStart
		|| previousSettings.strokeTaperEnd !== nextSettings.strokeTaperEnd;
}

function getFreehandSliderSettingKeys(): FreehandSliderSetting[] {
	return Object.keys(FREEHAND_SLIDER_SETTINGS) as FreehandSliderSetting[];
}

function getFreehandSliderSetting(value: string | undefined): FreehandSliderSetting | null {
	if (!value) {
		return null;
	}

	return Object.prototype.hasOwnProperty.call(FREEHAND_SLIDER_SETTINGS, value) ? value as FreehandSliderSetting : null;
}

function formatFreehandSliderValue(setting: FreehandSliderSetting, value: number): string {
	const slider = FREEHAND_SLIDER_SETTINGS[setting];
	return slider.step < 1 ? value.toFixed(2) : Math.round(value).toString();
}

function getBrushSliderSetting(value: string | undefined): BrushSliderSetting | null {
	return value === "size" || value === "opacity" ? value : null;
}

function getBrushSliderBounds(setting: BrushSliderSetting): {min: number; max: number; step: number} {
	return setting === "size"
		? {min: STROKE_WIDTH_MIN, max: STROKE_WIDTH_MAX, step: STROKE_WIDTH_STEP}
		: {min: STROKE_OPACITY_MIN, max: STROKE_OPACITY_MAX, step: STROKE_OPACITY_STEP};
}

function normalizeBrushSliderValue(setting: BrushSliderSetting, value: number): number {
	return setting === "size" ? normalizeStrokeWidth(value) : normalizeStrokeOpacity(value);
}

function formatBrushSliderThumbPosition(setting: BrushSliderSetting, value: number): string {
	const bounds = getBrushSliderBounds(setting);
	const normalizedValue = normalizeBrushSliderValue(setting, value);
	const ratio = (normalizedValue - bounds.min) / (bounds.max - bounds.min);
	return `${(1 - ratio) * 100}%`;
}

function getBrushSliderValueFromPointer(setting: BrushSliderSetting, sliderEl: HTMLElement, clientY: number): number {
	const bounds = getBrushSliderBounds(setting);
	const rect = sliderEl.getBoundingClientRect();
	const ratio = Math.min(1, Math.max(0, (rect.bottom - clientY) / rect.height));
	return normalizeBrushSliderValue(setting, bounds.min + ratio * (bounds.max - bounds.min));
}

function getBrushSliderKeyboardValue(setting: BrushSliderSetting, event: KeyboardEvent, currentValue: number): number | null {
	const bounds = getBrushSliderBounds(setting);
	const largeStep = bounds.step * 5;

	switch (event.key) {
		case "ArrowUp":
		case "ArrowRight":
			return normalizeBrushSliderValue(setting, Math.min(bounds.max, currentValue + bounds.step));

		case "ArrowDown":
		case "ArrowLeft":
			return normalizeBrushSliderValue(setting, Math.max(bounds.min, currentValue - bounds.step));

		case "PageUp":
			return normalizeBrushSliderValue(setting, Math.min(bounds.max, currentValue + largeStep));

		case "PageDown":
			return normalizeBrushSliderValue(setting, Math.max(bounds.min, currentValue - largeStep));

		case "Home":
			return bounds.min;

		case "End":
			return bounds.max;

		default:
			return null;
	}
}

function createBrushSliderControlEl(
	setting: BrushSliderSetting,
	label: string,
	valueClassName: string,
	valueText: string,
): HTMLElement {
	const sliderEl = document.createElement("div");
	const labelId = createStrokeId();

	sliderEl.classList.add("draw-in-canvas-brush-slider-control", "draw-in-canvas-brush-slider");
	sliderEl.dataset.brushSlider = setting;
	sliderEl.tabIndex = 0;
	sliderEl.setAttribute("role", "slider");
	sliderEl.setAttribute("aria-labelledby", labelId);
	sliderEl.setAttribute("aria-orientation", "vertical");

	const labelEl = document.createElement("span");
	labelEl.id = labelId;
	labelEl.classList.add("draw-in-canvas-brush-slider-label");
	labelEl.textContent = label;

	const trackEl = document.createElement("span");
	trackEl.classList.add("draw-in-canvas-brush-slider-track");

	const thumbEl = document.createElement("span");
	thumbEl.classList.add("draw-in-canvas-brush-slider-thumb");
	trackEl.appendChild(thumbEl);

	const valueEl = document.createElement("output");
	valueEl.classList.add("draw-in-canvas-brush-slider-value", valueClassName);
	valueEl.setAttribute("aria-live", "polite");
	valueEl.textContent = valueText;

	sliderEl.append(labelEl, trackEl, valueEl);
	return sliderEl;
}

function createSliderControlEl(
	inputId: string,
	label: string,
	valueClassName: string,
	valueText: string,
	sliderEl: HTMLInputElement,
): HTMLElement {
	const controlEl = document.createElement("div");
	controlEl.classList.add("draw-in-canvas-stroke-slider-control");

	const headerEl = document.createElement("div");
	headerEl.classList.add("draw-in-canvas-stroke-width-header");

	const labelEl = document.createElement("label");
	labelEl.htmlFor = inputId;
	labelEl.textContent = label;

	const valueEl = document.createElement("output");
	valueEl.classList.add(valueClassName);
	valueEl.setAttribute("for", inputId);
	valueEl.setAttribute("aria-live", "polite");
	valueEl.textContent = valueText;

	headerEl.append(labelEl, valueEl);
	controlEl.append(headerEl, sliderEl);
	return controlEl;
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

function getColorPaletteTab(value: string | undefined): ColorPaletteTab | null {
	return COLOR_PALETTE_TABS.some((tab) => tab.id === value) ? value as ColorPaletteTab : null;
}

function getColorPaletteTabFromKey(currentTab: ColorPaletteTab, event: KeyboardEvent): ColorPaletteTab | null {
	const currentIndex = COLOR_PALETTE_TABS.findIndex((tab) => tab.id === currentTab);

	if (currentIndex === -1) {
		return null;
	}

	switch (event.key) {
		case "ArrowRight":
		case "ArrowDown":
			return COLOR_PALETTE_TABS[(currentIndex + 1) % COLOR_PALETTE_TABS.length]?.id ?? currentTab;

		case "ArrowLeft":
		case "ArrowUp":
			return COLOR_PALETTE_TABS[(currentIndex - 1 + COLOR_PALETTE_TABS.length) % COLOR_PALETTE_TABS.length]?.id ?? currentTab;

		case "Home":
			return COLOR_PALETTE_TABS[0]?.id ?? currentTab;

		case "End":
			return COLOR_PALETTE_TABS[COLOR_PALETTE_TABS.length - 1]?.id ?? currentTab;

		default:
			return null;
	}
}

function getColorWheelControl(value: string | undefined): ColorWheelControl | null {
	return value === "hue" || value === "disc" ? value : null;
}

function getColorWheelHueFromPointer(element: HTMLElement, clientX: number, clientY: number): number {
	const rect = element.getBoundingClientRect();
	const x = clientX - (rect.left + rect.width / 2);
	const y = clientY - (rect.top + rect.height / 2);
	return normalizeHue(Math.atan2(y, x) * 180 / Math.PI);
}

function getColorWheelDiscValuesFromPointer(element: HTMLElement, clientX: number, clientY: number): Pick<HsvColor, "s" | "v"> {
	const rect = element.getBoundingClientRect();
	const point = constrainColorWheelDiscPoint({
		x: clampUnit((clientX - rect.left) / rect.width),
		y: clampUnit((clientY - rect.top) / rect.height),
	}, getColorWheelDiscThumbRadiusRatio(element));

	return {
		s: point.x,
		v: 1 - point.y,
	};
}

function getColorWheelDiscThumbPosition(color: HsvColor, element: HTMLElement | null): {x: number; y: number} {
	const point = constrainColorWheelDiscPoint({
		x: color.s,
		y: 1 - color.v,
	}, getColorWheelDiscThumbRadiusRatio(element));

	return {
		x: point.x * 100,
		y: point.y * 100,
	};
}

function constrainColorWheelDiscPoint(point: {x: number; y: number}, thumbRadiusRatio: number): {x: number; y: number} {
	const maxDistance = Math.max(0, 0.5 - thumbRadiusRatio);
	const dx = point.x - 0.5;
	const dy = point.y - 0.5;
	const distance = Math.hypot(dx, dy);

	if (distance <= maxDistance || distance === 0) {
		return point;
	}

	const scale = maxDistance / distance;
	return {
		x: 0.5 + dx * scale,
		y: 0.5 + dy * scale,
	};
}

function getColorWheelDiscThumbRadiusRatio(element: HTMLElement | null): number {
	const rect = element?.getBoundingClientRect();
	const diameter = Math.min(rect?.width ?? 0, rect?.height ?? 0);

	if (diameter <= 0) {
		return 0;
	}

	return Math.min(0.5, COLOR_WHEEL_DISC_THUMB_SIZE_PX / 2 / diameter);
}

function getColorWheelHueKeyboardColor(color: HsvColor, event: KeyboardEvent): HsvColor | null {
	const step = event.shiftKey ? COLOR_WHEEL_HUE_KEYBOARD_LARGE_STEP : COLOR_WHEEL_HUE_KEYBOARD_STEP;

	switch (event.key) {
		case "ArrowRight":
		case "ArrowUp":
			return {...color, h: normalizeHue(color.h + step)};

		case "ArrowLeft":
		case "ArrowDown":
			return {...color, h: normalizeHue(color.h - step)};

		case "PageUp":
			return {...color, h: normalizeHue(color.h + COLOR_WHEEL_HUE_KEYBOARD_LARGE_STEP)};

		case "PageDown":
			return {...color, h: normalizeHue(color.h - COLOR_WHEEL_HUE_KEYBOARD_LARGE_STEP)};

		case "Home":
			return {...color, h: 0};

		case "End":
			return {...color, h: 359};

		default:
			return null;
	}
}

function getColorWheelDiscKeyboardColor(color: HsvColor, event: KeyboardEvent): HsvColor | null {
	const step = event.shiftKey ? COLOR_WHEEL_KEYBOARD_LARGE_STEP : COLOR_WHEEL_KEYBOARD_STEP;

	switch (event.key) {
		case "ArrowRight":
			return {...color, s: clampUnit(color.s + step)};

		case "ArrowLeft":
			return {...color, s: clampUnit(color.s - step)};

		case "ArrowUp":
			return {...color, v: clampUnit(color.v + step)};

		case "ArrowDown":
			return {...color, v: clampUnit(color.v - step)};

		case "PageUp":
			return {...color, v: clampUnit(color.v + COLOR_WHEEL_KEYBOARD_LARGE_STEP)};

		case "PageDown":
			return {...color, v: clampUnit(color.v - COLOR_WHEEL_KEYBOARD_LARGE_STEP)};

		case "Home":
			return {...color, s: 0};

		case "End":
			return {...color, s: 1};

		default:
			return null;
	}
}

function getColorWheelHuePosition(hue: number): {x: number; y: number} {
	const angle = normalizeHue(hue) * Math.PI / 180;
	return {
		x: 50 + Math.cos(angle) * COLOR_WHEEL_HUE_RING_RADIUS_PERCENT,
		y: 50 + Math.sin(angle) * COLOR_WHEEL_HUE_RING_RADIUS_PERCENT,
	};
}

function getColorWheelHsv(hexColor: string, fallbackHue = 0): HsvColor {
	const hsv = hexToHsv(hexColor);

	if (!hsv) {
		return {h: normalizeHue(fallbackHue), s: 0, v: 0};
	}

	return {
		...hsv,
		h: hsv.s === 0 ? normalizeHue(fallbackHue) : hsv.h,
	};
}

function normalizeHsvColor(color: HsvColor): HsvColor {
	return {
		h: normalizeHue(color.h),
		s: clampUnit(color.s),
		v: clampUnit(color.v),
	};
}

function colorsMatch(a: string, b: string): boolean {
	const aHex = normalizeHexColor(a);
	const bHex = normalizeHexColor(b);

	if (aHex && bHex) {
		return aHex === bHex;
	}

	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function normalizeHexColor(value: string): string | null {
	const match = /^#?([\da-f]{6})$/i.exec(value.trim());
	const hexValue = match?.[1];

	if (!hexValue) {
		return null;
	}

	return `#${hexValue.toLowerCase()}`;
}

function formatHexColor(value: string): string {
	return (normalizeHexColor(value) ?? DEFAULT_CUSTOM_COLOR).toUpperCase();
}

function setHexInputValidity(inputEl: HTMLInputElement, isValid: boolean): void {
	inputEl.classList.toggle("is-invalid", !isValid);
	inputEl.setAttribute("aria-invalid", (!isValid).toString());
}

function getCustomColorShades(hexColor: string): Array<{name: string; value: string}> {
	const baseColor = hexToRgb(hexColor) ?? hexToRgb(DEFAULT_CUSTOM_COLOR);

	if (!baseColor) {
		return [];
	}

	return [
		{name: "Lightest shade", value: rgbToHex(mixRgb(baseColor, {r: 255, g: 255, b: 255}, 0.72))},
		{name: "Light shade", value: rgbToHex(mixRgb(baseColor, {r: 255, g: 255, b: 255}, 0.48))},
		{name: "Soft shade", value: rgbToHex(mixRgb(baseColor, {r: 255, g: 255, b: 255}, 0.24))},
		{name: "Base shade", value: rgbToHex(baseColor)},
		{name: "Deep shade", value: rgbToHex(mixRgb(baseColor, {r: 0, g: 0, b: 0}, 0.18))},
		{name: "Darkest shade", value: rgbToHex(mixRgb(baseColor, {r: 0, g: 0, b: 0}, 0.36))},
	];
}

function hexToRgb(hexColor: string): RgbColor | null {
	const hexValue = normalizeHexColor(hexColor)?.slice(1);

	if (!hexValue) {
		return null;
	}

	return {
		r: Number.parseInt(hexValue.slice(0, 2), 16),
		g: Number.parseInt(hexValue.slice(2, 4), 16),
		b: Number.parseInt(hexValue.slice(4, 6), 16),
	};
}

function hexToHsv(hexColor: string): HsvColor | null {
	const rgbColor = hexToRgb(hexColor);
	return rgbColor ? rgbToHsv(rgbColor) : null;
}

function rgbToHsv(color: RgbColor): HsvColor {
	const r = color.r / 255;
	const g = color.g / 255;
	const b = color.b / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	let hue = 0;

	if (delta > 0) {
		if (max === r) {
			hue = 60 * (((g - b) / delta) % 6);
		} else if (max === g) {
			hue = 60 * ((b - r) / delta + 2);
		} else {
			hue = 60 * ((r - g) / delta + 4);
		}
	}

	return {
		h: normalizeHue(hue),
		s: max === 0 ? 0 : delta / max,
		v: max,
	};
}

function hsvToHex(color: HsvColor): string {
	return rgbToHex(hsvToRgb(color));
}

function hsvToRgb(color: HsvColor): RgbColor {
	const normalizedColor = normalizeHsvColor(color);
	const hue = normalizedColor.h / 60;
	const chroma = normalizedColor.v * normalizedColor.s;
	const x = chroma * (1 - Math.abs(hue % 2 - 1));
	const m = normalizedColor.v - chroma;
	let r = 0;
	let g = 0;
	let b = 0;

	if (hue < 1) {
		r = chroma;
		g = x;
	} else if (hue < 2) {
		r = x;
		g = chroma;
	} else if (hue < 3) {
		g = chroma;
		b = x;
	} else if (hue < 4) {
		g = x;
		b = chroma;
	} else if (hue < 5) {
		r = x;
		b = chroma;
	} else {
		r = chroma;
		b = x;
	}

	return {
		r: (r + m) * 255,
		g: (g + m) * 255,
		b: (b + m) * 255,
	};
}

function mixRgb(from: RgbColor, to: RgbColor, amount: number): RgbColor {
	return {
		r: Math.round(from.r + (to.r - from.r) * amount),
		g: Math.round(from.g + (to.g - from.g) * amount),
		b: Math.round(from.b + (to.b - from.b) * amount),
	};
}

function rgbToHex(color: RgbColor): string {
	return `#${[color.r, color.g, color.b].map((value) => clampRgb(value).toString(16).padStart(2, "0")).join("")}`;
}

function clampRgb(value: number): number {
	return Math.min(255, Math.max(0, Math.round(value)));
}

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function normalizeHue(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return (value % 360 + 360) % 360;
}

function formatStrokeWidth(width: number): string {
	return `${normalizeStrokeWidth(width)} px`;
}

function formatStrokeHardness(hardness: number): string {
	return `${normalizeStrokeHardness(hardness)}%`;
}

function formatStrokeOpacity(opacity: number): string {
	return `${normalizeStrokeOpacity(opacity)}%`;
}

function formatStrokeOpacityRatio(opacity: number): string {
	return (normalizeStrokeOpacity(opacity) / 100).toString();
}

function getStrokeHardnessBlurRadius(stroke: CanvasStroke): number {
	const softness = 1 - normalizeStrokeHardness(stroke.hardness) / 100;

	if (softness <= 0) {
		return 0;
	}

	return roundCoordinate(Math.max(0, stroke.width * softness * 0.35));
}

function createStrokePoint(x: number, y: number, event: PointerEvent): StrokePoint {
	const point: StrokePoint = {
		x: roundCoordinate(x),
		y: roundCoordinate(y),
	};
	const pressure = getPointerPressure(event);

	if (pressure !== undefined) {
		point.pressure = pressure;
	}

	return point;
}

function getPointerPressure(event: PointerEvent): number | undefined {
	if (!shouldCapturePointerPressure(event)) {
		return undefined;
	}

	return normalizeStrokePressure(event.pressure);
}

function shouldCapturePointerPressure(event: PointerEvent): boolean {
	return isPenPointerEvent(event);
}

function isPenPointerEvent(event: PointerEvent): boolean {
	return event.pointerType === "pen";
}

function isPointerEventInsideElement(event: PointerEvent, element: Element): boolean {
	const rect = element.getBoundingClientRect();

	return event.clientX >= rect.left
		&& event.clientX <= rect.right
		&& event.clientY >= rect.top
		&& event.clientY <= rect.bottom;
}

function getSvgScreenScale(matrix: DOMMatrix): number {
	const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
	return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function getCoalescedPointerEvents(event: PointerEvent): PointerEvent[] {
	const coalescedEvents = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
	return coalescedEvents;
}

function getStrokePointSubset(stroke: CanvasStroke, startIndex: number, endIndex: number): CanvasStroke {
	return {
		...stroke,
		points: stroke.points.slice(startIndex, endIndex),
	};
}

function strokeHasPressure(stroke: CanvasStroke): boolean {
	return stroke.points.some((point) => point.pressure !== undefined);
}

function hasSelectionModifier(event: MouseEvent | PointerEvent): boolean {
	return event.shiftKey || event.ctrlKey || event.metaKey;
}

function isSpaceKeyEvent(event: KeyboardEvent): boolean {
	return event.code === "Space" || event.key === " ";
}

function isSelectToolShortcutEvent(event: KeyboardEvent): boolean {
	return event.key === "1" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
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
	const clonedPoint: StrokePoint = {x: point.x, y: point.y};

	if (point.pressure !== undefined) {
		clonedPoint.pressure = point.pressure;
	}

	return clonedPoint;
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