export type CanvasResizePointerdown<Node extends CanvasResizePrototypeNode = CanvasResizePrototypeNode> = (
	this: Node,
	event: PointerEvent,
	resizeHandle: string,
) => void;

export interface CanvasNodeResizePrototype<Node extends CanvasResizePrototypeNode = CanvasResizePrototypeNode> {
	onResizePointerdown?: CanvasResizePointerdown<Node>;
}

export interface CanvasResizePrototypeNode {
	id?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	moveAndResize?: unknown;
	getData?: unknown;
	setData?: unknown;
}

export interface CanvasResizePrototypeCanvas<Node extends CanvasResizePrototypeNode = CanvasResizePrototypeNode> {
	nodes?: Map<string, Node>;
	selection?: Set<unknown>;
}

export function getSelectedCanvasNodeResizePrototypes<Node extends CanvasResizePrototypeNode>(
	canvas: CanvasResizePrototypeCanvas<Node>,
): Array<CanvasNodeResizePrototype<Node>> {
	const resizePrototypes = new Set<CanvasNodeResizePrototype<Node>>();

	for (const selectedItem of canvas.selection ?? []) {
		const node = getCanvasNode(canvas, selectedItem);

		if (!node || !isResizableCanvasNode(node)) {
			continue;
		}

		for (const resizePrototype of getNodeResizePointerdownPrototypes(node)) {
			resizePrototypes.add(resizePrototype);
		}
	}

	return Array.from(resizePrototypes);
}

function getNodeResizePointerdownPrototypes<Node extends CanvasResizePrototypeNode>(
	node: Node,
): Array<CanvasNodeResizePrototype<Node>> {
	const resizePrototypes: Array<CanvasNodeResizePrototype<Node>> = [];
	let prototype: object | null = Object.getPrototypeOf(node) as object | null;

	while (prototype && prototype !== Object.prototype) {
		const resizePrototype = prototype as CanvasNodeResizePrototype<Node>;

		if (Object.prototype.hasOwnProperty.call(resizePrototype, "onResizePointerdown")
			&& typeof resizePrototype.onResizePointerdown === "function") {
			resizePrototypes.push(resizePrototype);
		}

		prototype = Object.getPrototypeOf(prototype) as object | null;
	}

	return resizePrototypes;
}

function getCanvasNode<Node extends CanvasResizePrototypeNode>(
	canvas: CanvasResizePrototypeCanvas<Node>,
	selectedItem: unknown,
): Node | null {
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

function isLayerableCanvasNode(value: unknown): value is CanvasResizePrototypeNode & {id: string} {
	if (!value || typeof value !== "object") {
		return false;
	}

	const node = value as Partial<CanvasResizePrototypeNode>;
	return typeof node.id === "string" && node.id.length > 0;
}

function isResizableCanvasNode<Node extends CanvasResizePrototypeNode>(node: Node): boolean {
	return isPositiveFiniteNumber(node.width)
		&& isPositiveFiniteNumber(node.height)
		&& isFiniteNumber(node.x)
		&& isFiniteNumber(node.y)
		&& (typeof node.moveAndResize === "function" || (typeof node.getData === "function" && typeof node.setData === "function"));
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
	return isFiniteNumber(value) && value > 0;
}
