export const CONTENT_SCALE_DATA_KEY = "drawInCanvasScale";
export const CONTENT_SCALE_CLASS = "draw-in-canvas-scaled-node-content";

const DEFAULT_CONTENT_SCALE = 1;
const MIN_CONTENT_SCALE = 0.01;
const MAX_CONTENT_SCALE = 100;
const CONTENT_SCALE_EPSILON = 0.001;

export interface CanvasContentScaleNodeData {
	id?: string;
	type?: string;
	drawInCanvasScale?: number;
}

export interface CanvasContentScaleNode {
	id?: string;
	nodeEl?: HTMLElement;
	getData?: () => CanvasContentScaleNodeData;
}

export interface CanvasContentScaleCanvas {
	nodes?: Map<string, CanvasContentScaleNode>;
}

interface ScaledContentEntry {
	contentEl: HTMLElement | null;
}

type StyleableContentEl = HTMLElement & {
	setCssStyles(styles: Record<string, string>): void;
};

export class NativeCanvasContentScaleSync {
	private hasSyncedContentScales = false;
	private hasTrackedContentScales = false;
	private contentScaleCanvas: CanvasContentScaleCanvas | null = null;
	private hasContentScaleNodeMap = false;
	private contentScaleNodeCount = 0;
	private readonly scaledContentByNodeId = new Map<string, ScaledContentEntry>();
	private readonly getContainerEl: () => HTMLElement;

	constructor(getContainerEl: () => HTMLElement) {
		this.getContainerEl = getContainerEl;
	}

	syncForCanvas(canvas: CanvasContentScaleCanvas | null): void {
		if (!canvas?.nodes) {
			this.clear();
			this.contentScaleCanvas = canvas;
			this.hasContentScaleNodeMap = false;
			return;
		}

		if (canvas !== this.contentScaleCanvas
			|| !this.hasContentScaleNodeMap
			|| !this.hasSyncedContentScales
			|| canvas.nodes.size !== this.contentScaleNodeCount) {
			this.syncFull(canvas);
			return;
		}

		if (!this.hasTrackedContentScales) {
			return;
		}

		this.syncTrackedContentScales(canvas);
	}

	syncChangedNodes(canvas: CanvasContentScaleCanvas | null, nodes: readonly CanvasContentScaleNode[]): void {
		if (nodes.length === 0) {
			return;
		}

		if (!canvas?.nodes) {
			this.syncForCanvas(canvas);
			return;
		}

		if (canvas !== this.contentScaleCanvas
			|| !this.hasContentScaleNodeMap
			|| !this.hasSyncedContentScales
			|| canvas.nodes.size !== this.contentScaleNodeCount) {
			this.syncFull(canvas);
			return;
		}

		for (const node of nodes) {
			const nodeId = getContentScaleNodeId(node);

			if (!nodeId || canvas.nodes.get(nodeId) !== node) {
				continue;
			}

			this.syncNodeContentScale(nodeId, node);
		}

		this.hasTrackedContentScales = this.scaledContentByNodeId.size > 0;
	}

	clear(): void {
		for (const contentEl of Array.from(this.getContainerEl().querySelectorAll<HTMLElement>(`.${CONTENT_SCALE_CLASS}`))) {
			clearContentScaleStyles(contentEl);
		}

		this.scaledContentByNodeId.clear();
		this.hasSyncedContentScales = true;
		this.hasTrackedContentScales = false;
		this.contentScaleCanvas = null;
		this.hasContentScaleNodeMap = false;
		this.contentScaleNodeCount = 0;
	}

	private syncFull(canvas: CanvasContentScaleCanvas): void {
		const activeContentEls = new Set<HTMLElement>();
		this.scaledContentByNodeId.clear();

		for (const [nodeId, node] of canvas.nodes?.entries() ?? []) {
			const data = node.getData?.();
			const scale = data?.type === "text" ? getContentScaleFromData(data) : DEFAULT_CONTENT_SCALE;
			const shouldApplyScale = data?.type === "text" && !isDefaultContentScale(scale);
			const contentEl = getNodeContentEl(node);

			if (!contentEl) {
				if (shouldApplyScale) {
					this.scaledContentByNodeId.set(nodeId, {contentEl: null});
				}

				continue;
			}

			if (!shouldApplyScale) {
				clearContentScaleStyles(contentEl);
				continue;
			}

			applyContentScaleStyles(contentEl, scale);
			activeContentEls.add(contentEl);
			this.scaledContentByNodeId.set(nodeId, {contentEl});
		}

		this.clearStaleContentScaleEls(activeContentEls);
		this.hasSyncedContentScales = true;
		this.hasTrackedContentScales = this.scaledContentByNodeId.size > 0;
		this.contentScaleCanvas = canvas;
		this.hasContentScaleNodeMap = true;
		this.contentScaleNodeCount = canvas.nodes?.size ?? 0;
	}

	private syncTrackedContentScales(canvas: CanvasContentScaleCanvas): void {
		for (const [nodeId, entry] of Array.from(this.scaledContentByNodeId.entries())) {
			const node = canvas.nodes?.get(nodeId);

			if (!node) {
				clearPreviousContentEl(entry, null);
				this.scaledContentByNodeId.delete(nodeId);
				continue;
			}

			this.syncNodeContentScale(nodeId, node);
		}

		this.hasTrackedContentScales = this.scaledContentByNodeId.size > 0;
	}

	private syncNodeContentScale(nodeId: string, node: CanvasContentScaleNode): void {
		const entry = this.scaledContentByNodeId.get(nodeId);
		const data = node.getData?.();
		const contentEl = getNodeContentEl(node);
		const scale = data?.type === "text" ? getContentScaleFromData(data) : DEFAULT_CONTENT_SCALE;

		if (data?.type !== "text") {
			clearPreviousContentEl(entry, contentEl);

			if (contentEl) {
				clearContentScaleStyles(contentEl);
			}

			this.scaledContentByNodeId.delete(nodeId);
			return;
		}

		if (isDefaultContentScale(scale)) {
			clearPreviousContentEl(entry, contentEl);

			if (contentEl) {
				clearContentScaleStyles(contentEl);
			}

			if (entry) {
				this.scaledContentByNodeId.set(nodeId, {contentEl});
			} else {
				this.scaledContentByNodeId.delete(nodeId);
			}

			return;
		}

		clearPreviousContentEl(entry, contentEl);

		if (contentEl) {
			applyContentScaleStyles(contentEl, scale);
		}

		this.scaledContentByNodeId.set(nodeId, {contentEl});
	}

	private clearStaleContentScaleEls(activeContentEls: ReadonlySet<HTMLElement>): void {
		for (const contentEl of Array.from(this.getContainerEl().querySelectorAll<HTMLElement>(`.${CONTENT_SCALE_CLASS}`))) {
			if (!activeContentEls.has(contentEl)) {
				clearContentScaleStyles(contentEl);
			}
		}
	}
}

export function getNextNodeContentScale(node: CanvasContentScaleNode, scale: number): number | null {
	if (!shouldScaleNodeContent(node)) {
		return null;
	}

	return roundContentScale(getNodeContentScale(node) * scale);
}

export function shouldScaleNodeContent(node: CanvasContentScaleNode): boolean {
	return node.getData?.().type === "text";
}

export function getNodeContentScale(node: CanvasContentScaleNode): number {
	return getContentScaleFromData(node.getData?.());
}

export function setNodeContentScale(data: CanvasContentScaleNodeData, scale: number | null): void {
	if (scale === null || isDefaultContentScale(scale)) {
		delete data.drawInCanvasScale;
		return;
	}

	data.drawInCanvasScale = scale;
}

export function applyNodeContentScale(node: CanvasContentScaleNode): void {
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

function getContentScaleFromData(data: CanvasContentScaleNodeData | undefined): number {
	const value = data?.[CONTENT_SCALE_DATA_KEY];

	if (!isPositiveFiniteNumber(value)) {
		return DEFAULT_CONTENT_SCALE;
	}

	return Math.min(MAX_CONTENT_SCALE, Math.max(MIN_CONTENT_SCALE, value));
}

function getNodeContentEl(node: CanvasContentScaleNode): HTMLElement | null {
	return node.nodeEl?.querySelector<HTMLElement>(".canvas-node-content") ?? null;
}

function applyContentScaleStyles(contentEl: HTMLElement, scale: number): void {
	contentEl.classList.add(CONTENT_SCALE_CLASS);
	(contentEl as StyleableContentEl).setCssStyles({
		transform: `scale(${scale})`,
		transformOrigin: "top left",
		width: `${100 / scale}%`,
		height: `${100 / scale}%`,
		flex: "0 0 auto",
	});
}

function clearContentScaleStyles(contentEl: HTMLElement): void {
	contentEl.classList.remove(CONTENT_SCALE_CLASS);
	(contentEl as StyleableContentEl).setCssStyles({
		transform: "",
		transformOrigin: "",
		width: "",
		height: "",
		flex: "",
	});
}

function clearPreviousContentEl(entry: ScaledContentEntry | undefined, nextContentEl: HTMLElement | null): void {
	if (entry?.contentEl && entry.contentEl !== nextContentEl) {
		clearContentScaleStyles(entry.contentEl);
	}
}

function getContentScaleNodeId(node: CanvasContentScaleNode): string | null {
	if (typeof node.id === "string" && node.id.length > 0) {
		return node.id;
	}

	const dataId = node.getData?.().id;
	return typeof dataId === "string" && dataId.length > 0 ? dataId : null;
}

function isDefaultContentScale(scale: number): boolean {
	return Math.abs(scale - DEFAULT_CONTENT_SCALE) < CONTENT_SCALE_EPSILON;
}

function roundContentScale(value: number): number {
	const clampedValue = Math.min(MAX_CONTENT_SCALE, Math.max(MIN_CONTENT_SCALE, value));
	return Math.round(clampedValue * 1000) / 1000;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
	return isFiniteNumber(value) && value > 0;
}
