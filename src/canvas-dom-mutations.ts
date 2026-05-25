export interface CanvasDomMutationSyncFlags {
	syncTinyCanvasControls: boolean;
	syncNativeElementControls: boolean;
}

export const CANVAS_DOM_MUTATION_SYNC_NONE: CanvasDomMutationSyncFlags = {
	syncTinyCanvasControls: false,
	syncNativeElementControls: false,
};

export const CANVAS_DOM_MUTATION_SYNC_ALL: CanvasDomMutationSyncFlags = {
	syncTinyCanvasControls: true,
	syncNativeElementControls: true,
};

const DRAW_IN_CANVAS_CLASS_PREFIX = "draw-in-canvas-";
const NATIVE_ELEMENT_ATTRIBUTE_CLASSES = [
	"canvas-menu",
	"canvas-node",
	"canvas-node-content",
	"canvas-selection",
] as const;
const NATIVE_ELEMENT_CHILD_LIST_TARGET_CLASSES = [
	"canvas-menu",
	"canvas-node",
	"canvas-selection",
] as const;
const TINY_CONTROL_CLASSES = [
	"canvas-edges",
	"canvas-display-path",
	"canvas-interaction-path",
	"canvas-path-end",
	"canvas-snaps",
] as const;
const CANVAS_VIEWPORT_ATTRIBUTE_CLASSES = ["canvas"] as const;
const KNOWN_NEUTRAL_CHILD_LIST_TARGET_CLASSES = [
	"canvas",
	"canvas-wrapper",
	"canvas-controls",
	"view-content",
] as const;
const KNOWN_NEUTRAL_ATTRIBUTE_ANCESTOR_CLASSES = [
	"canvas-controls",
	"canvas-node-content",
] as const;

interface ElementLike {
	classList?: {
		contains?: (className: string) => boolean;
	};
	className?: unknown;
	parentElement?: unknown;
	childNodes?: unknown;
	children?: unknown;
	querySelector?: (selectors: string) => unknown;
	nodeType?: unknown;
}

interface MutationRecordLike {
	type?: unknown;
	target?: unknown;
	attributeName?: unknown;
	addedNodes?: unknown;
	removedNodes?: unknown;
	oldValue?: unknown;
}

export function getCanvasDomMutationSyncFlags(records: readonly MutationRecord[]): CanvasDomMutationSyncFlags {
	if (records.length === 0) {
		return {...CANVAS_DOM_MUTATION_SYNC_ALL};
	}

	let flags = {...CANVAS_DOM_MUTATION_SYNC_NONE};

	for (const record of records) {
		flags = mergeCanvasDomMutationSyncFlags(flags, getCanvasDomMutationRecordSyncFlags(record));

		if (areCanvasDomMutationSyncFlagsEqual(flags, CANVAS_DOM_MUTATION_SYNC_ALL)) {
			break;
		}
	}

	return flags;
}

export function mergeCanvasDomMutationSyncFlags(
	a: CanvasDomMutationSyncFlags,
	b: CanvasDomMutationSyncFlags,
): CanvasDomMutationSyncFlags {
	return {
		syncTinyCanvasControls: a.syncTinyCanvasControls || b.syncTinyCanvasControls,
		syncNativeElementControls: a.syncNativeElementControls || b.syncNativeElementControls,
	};
}

function getCanvasDomMutationRecordSyncFlags(record: MutationRecord): CanvasDomMutationSyncFlags {
	const mutationRecord = record as MutationRecordLike;

	if (mutationRecord.type === "attributes") {
		return getAttributeMutationSyncFlags(mutationRecord);
	}

	if (mutationRecord.type === "childList") {
		return getChildListMutationSyncFlags(mutationRecord);
	}

	return {...CANVAS_DOM_MUTATION_SYNC_ALL};
}

function getAttributeMutationSyncFlags(record: MutationRecordLike): CanvasDomMutationSyncFlags {
	const targetEl = toElementLike(record.target);

	if (!targetEl) {
		return {...CANVAS_DOM_MUTATION_SYNC_ALL};
	}

	if (isPluginOwnedAttributeMutation(record, targetEl)) {
		return {...CANVAS_DOM_MUTATION_SYNC_NONE};
	}

	if (elementHasAnyClass(targetEl, TINY_CONTROL_CLASSES) || elementOrAncestorHasAnyClass(targetEl, ["canvas-edges", "canvas-snaps"])) {
		return {
			syncTinyCanvasControls: true,
			syncNativeElementControls: false,
		};
	}

	if (elementHasAnyClass(targetEl, CANVAS_VIEWPORT_ATTRIBUTE_CLASSES)) {
		return {
			syncTinyCanvasControls: true,
			syncNativeElementControls: false,
		};
	}

	if (elementHasAnyClass(targetEl, NATIVE_ELEMENT_ATTRIBUTE_CLASSES) || elementOrAncestorHasAnyClass(targetEl, ["canvas-menu"])) {
		return {
			syncTinyCanvasControls: false,
			syncNativeElementControls: true,
		};
	}

	if (elementOrAncestorHasAnyClass(targetEl, KNOWN_NEUTRAL_ATTRIBUTE_ANCESTOR_CLASSES)) {
		return {...CANVAS_DOM_MUTATION_SYNC_NONE};
	}

	return {...CANVAS_DOM_MUTATION_SYNC_ALL};
}

function getChildListMutationSyncFlags(record: MutationRecordLike): CanvasDomMutationSyncFlags {
	const targetEl = toElementLike(record.target);

	if (!targetEl) {
		return {...CANVAS_DOM_MUTATION_SYNC_ALL};
	}

	let flags = {...CANVAS_DOM_MUTATION_SYNC_NONE};
	let hasUnknownChangedElement = false;
	let hasPluginOwnedChangedElement = false;
	let hasNonPluginOwnedChangedElement = false;

	for (const changedNode of [...toNodeArray(record.addedNodes), ...toNodeArray(record.removedNodes)]) {
		const changedEl = toElementLike(changedNode);

		if (!changedEl) {
			continue;
		}

		if (isPluginOwnedElement(changedEl)) {
			hasPluginOwnedChangedElement = true;
			continue;
		}

		hasNonPluginOwnedChangedElement = true;
		const changedFlags = getChangedElementSyncFlags(changedEl);
		flags = mergeCanvasDomMutationSyncFlags(flags, changedFlags);

		if (areCanvasDomMutationSyncFlagsEqual(changedFlags, CANVAS_DOM_MUTATION_SYNC_NONE)) {
			hasUnknownChangedElement = true;
		}
	}

	if (hasPluginOwnedChangedElement && !hasNonPluginOwnedChangedElement && !hasUnknownChangedElement) {
		return {...CANVAS_DOM_MUTATION_SYNC_NONE};
	}

	const targetFlags = getChildListTargetSyncFlags(targetEl);
	flags = mergeCanvasDomMutationSyncFlags(flags, targetFlags);

	if (!areCanvasDomMutationSyncFlagsEqual(flags, CANVAS_DOM_MUTATION_SYNC_NONE)) {
		return flags;
	}

	if (isPluginOwnedElement(targetEl)
		|| elementHasAnyClass(targetEl, ["canvas-node-content"])) {
		return {...CANVAS_DOM_MUTATION_SYNC_NONE};
	}

	if (hasUnknownChangedElement) {
		return {...CANVAS_DOM_MUTATION_SYNC_ALL};
	}

	if (elementHasAnyClass(targetEl, KNOWN_NEUTRAL_CHILD_LIST_TARGET_CLASSES)) {
		return {...CANVAS_DOM_MUTATION_SYNC_NONE};
	}

	return {...CANVAS_DOM_MUTATION_SYNC_ALL};
}

function getChangedElementSyncFlags(element: ElementLike): CanvasDomMutationSyncFlags {
	return {
		syncTinyCanvasControls: elementOrDescendantHasAnyClass(element, TINY_CONTROL_CLASSES),
		syncNativeElementControls: elementOrDescendantHasAnyClass(element, NATIVE_ELEMENT_ATTRIBUTE_CLASSES),
	};
}

function getChildListTargetSyncFlags(targetEl: ElementLike): CanvasDomMutationSyncFlags {
	return {
		syncTinyCanvasControls: elementHasAnyClass(targetEl, TINY_CONTROL_CLASSES) || elementOrAncestorHasAnyClass(targetEl, ["canvas-edges", "canvas-snaps"]),
		syncNativeElementControls: elementHasAnyClass(targetEl, NATIVE_ELEMENT_CHILD_LIST_TARGET_CLASSES),
	};
}

function areCanvasDomMutationSyncFlagsEqual(a: CanvasDomMutationSyncFlags, b: CanvasDomMutationSyncFlags): boolean {
	return a.syncTinyCanvasControls === b.syncTinyCanvasControls
		&& a.syncNativeElementControls === b.syncNativeElementControls;
}

function elementOrDescendantHasAnyClass(element: ElementLike, classNames: readonly string[]): boolean {
	if (elementHasAnyClass(element, classNames)) {
		return true;
	}

	const selector = classNames.map((className) => `.${className}`).join(", ");

	if (typeof element.querySelector === "function") {
		try {
			if (element.querySelector(selector)) {
				return true;
			}
		} catch {
			// Some test doubles do not implement CSS selector parsing. Fall back to tree walking.
		}
	}

	for (const childNode of getElementChildren(element)) {
		const childEl = toElementLike(childNode);

		if (childEl && elementOrDescendantHasAnyClass(childEl, classNames)) {
			return true;
		}
	}

	return false;
}

function elementOrAncestorHasAnyClass(element: ElementLike, classNames: readonly string[]): boolean {
	let currentEl: ElementLike | null = element;

	while (currentEl) {
		if (elementHasAnyClass(currentEl, classNames)) {
			return true;
		}

		currentEl = toElementLike(currentEl.parentElement);
	}

	return false;
}

function isPluginOwnedAttributeMutation(record: MutationRecordLike, element: ElementLike): boolean {
	if (!isPluginOwnedElement(element)) {
		return false;
	}

	if (!elementHasAnyClass(element, NATIVE_ELEMENT_ATTRIBUTE_CLASSES)) {
		return true;
	}

	if (record.attributeName === "class") {
		return typeof record.oldValue === "string"
			&& haveSameNonPluginClassNames(record.oldValue, getElementClassName(element));
	}

	return record.attributeName === "style";
}

function isPluginOwnedElement(element: ElementLike): boolean {
	if (elementHasAnyClass(element, TINY_CONTROL_CLASSES)
		|| elementHasAnyClass(element, CANVAS_VIEWPORT_ATTRIBUTE_CLASSES)) {
		return false;
	}

	return elementOrAncestorHasClassPrefix(element, DRAW_IN_CANVAS_CLASS_PREFIX);
}

function elementOrAncestorHasClassPrefix(element: ElementLike, classPrefix: string): boolean {
	let currentEl: ElementLike | null = element;

	while (currentEl) {
		if (elementHasClassPrefix(currentEl, classPrefix)) {
			return true;
		}

		currentEl = toElementLike(currentEl.parentElement);
	}

	return false;
}

function elementHasAnyClass(element: ElementLike, classNames: readonly string[]): boolean {
	return classNames.some((className) => elementHasClass(element, className));
}

function elementHasClass(element: ElementLike, className: string): boolean {
	if (typeof element.classList?.contains === "function" && element.classList.contains(className)) {
		return true;
	}

	return getElementClassNames(element).includes(className);
}

function elementHasClassPrefix(element: ElementLike, classPrefix: string): boolean {
	return getElementClassNames(element).some((className) => className.startsWith(classPrefix));
}

function haveSameNonPluginClassNames(a: string, b: string): boolean {
	const aClasses = getNonPluginClassNames(splitClassName(a));
	const bClasses = getNonPluginClassNames(splitClassName(b));

	if (aClasses.length !== bClasses.length) {
		return false;
	}

	return aClasses.every((className, index) => className === bClasses[index]);
}

function getNonPluginClassNames(classNames: readonly string[]): string[] {
	return classNames
		.filter((className) => !className.startsWith(DRAW_IN_CANVAS_CLASS_PREFIX))
		.sort();
}

function getElementClassNames(element: ElementLike): string[] {
	return splitClassName(getElementClassName(element));
}

function getElementClassName(element: ElementLike): string {
	const className = element.className;

	if (typeof className === "string") {
		return className;
	}

	if (className && typeof className === "object" && "baseVal" in className) {
		const baseVal = (className as {baseVal?: unknown}).baseVal;
		return typeof baseVal === "string" ? baseVal : "";
	}

	return "";
}

function splitClassName(className: string): string[] {
	return className.split(/\s+/).filter((value) => value.length > 0);
}

function getElementChildren(element: ElementLike): unknown[] {
	const childNodes = toNodeArray(element.childNodes);

	if (childNodes.length > 0) {
		return childNodes;
	}

	return toNodeArray(element.children);
}

function toNodeArray(nodes: unknown): unknown[] {
	if (!nodes) {
		return [];
	}

	const iterable = nodes as Iterable<unknown>;

	if (typeof iterable[Symbol.iterator] === "function") {
		return Array.from(iterable);
	}

	const arrayLike = nodes as {length?: unknown};

	if (typeof arrayLike.length === "number") {
		return Array.from(nodes as ArrayLike<unknown>);
	}

	return [];
}

function toElementLike(value: unknown): ElementLike | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const element = value as ElementLike;

	if (element.nodeType === 1
		|| "classList" in element
		|| "className" in element
		|| "querySelector" in element) {
		return element;
	}

	return null;
}
