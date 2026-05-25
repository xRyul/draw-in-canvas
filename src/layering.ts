export type LayerAction = "bring-forward" | "bring-to-front" | "send-backward" | "send-to-back";
export type LayerActionAvailability = Record<LayerAction, boolean>;

export function reorderIdsByLayerAction(
	ids: readonly string[],
	selectedIds: ReadonlySet<string> | readonly string[],
	action: LayerAction,
): string[] {
	const selectedIdSet = selectedIds instanceof Set
		? selectedIds
		: new Set(selectedIds);

	switch (action) {
		case "bring-forward":
			return bringIdsForward(ids, selectedIdSet);

		case "bring-to-front":
			return moveIdsToFront(ids, selectedIdSet);

		case "send-backward":
			return sendIdsBackward(ids, selectedIdSet);

		case "send-to-back":
			return moveIdsToBack(ids, selectedIdSet);

		default:
			return assertNever(action);
	}
}

export function hasLayerOrderChanged(
	ids: readonly string[],
	selectedIds: ReadonlySet<string> | readonly string[],
	action: LayerAction,
): boolean {
	const reorderedIds = reorderIdsByLayerAction(ids, selectedIds, action);
	return !areIdOrdersEqual(ids, reorderedIds);
}

export function getLayerActionAvailability(
	ids: readonly string[],
	selectedIds: ReadonlySet<string> | readonly string[],
): LayerActionAvailability {
	const selectedIdSet = selectedIds instanceof Set
		? selectedIds
		: new Set(selectedIds);

	return {
		"bring-forward": hasLayerOrderChanged(ids, selectedIdSet, "bring-forward"),
		"bring-to-front": hasLayerOrderChanged(ids, selectedIdSet, "bring-to-front"),
		"send-backward": hasLayerOrderChanged(ids, selectedIdSet, "send-backward"),
		"send-to-back": hasLayerOrderChanged(ids, selectedIdSet, "send-to-back"),
	};
}

export function areIdOrdersEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}

	return a.every((id, index) => id === b[index]);
}

export function orderItemsByIds<T extends {id?: string}>(items: readonly T[], ids: readonly string[]): T[] {
	const itemById = new Map<string, T>();

	for (const item of items) {
		if (typeof item.id === "string") {
			itemById.set(item.id, item);
		}
	}

	const orderedItems: T[] = [];
	const usedItemIds = new Set<string>();

	for (const id of ids) {
		const item = itemById.get(id);

		if (!item || usedItemIds.has(id)) {
			continue;
		}

		orderedItems.push(item);
		usedItemIds.add(id);
	}

	for (const item of items) {
		if (typeof item.id !== "string" || !usedItemIds.has(item.id)) {
			orderedItems.push(item);
		}
	}

	return orderedItems;
}

function bringIdsForward(ids: readonly string[], selectedIds: ReadonlySet<string>): string[] {
	const reorderedIds = [...ids];

	for (let index = reorderedIds.length - 2; index >= 0; index--) {
		const id = reorderedIds[index];
		const nextId = reorderedIds[index + 1];

		if (id && nextId && selectedIds.has(id) && !selectedIds.has(nextId)) {
			reorderedIds[index] = nextId;
			reorderedIds[index + 1] = id;
		}
	}

	return reorderedIds;
}

function sendIdsBackward(ids: readonly string[], selectedIds: ReadonlySet<string>): string[] {
	const reorderedIds = [...ids];

	for (let index = 1; index < reorderedIds.length; index++) {
		const id = reorderedIds[index];
		const previousId = reorderedIds[index - 1];

		if (id && previousId && selectedIds.has(id) && !selectedIds.has(previousId)) {
			reorderedIds[index - 1] = id;
			reorderedIds[index] = previousId;
		}
	}

	return reorderedIds;
}

function moveIdsToFront(ids: readonly string[], selectedIds: ReadonlySet<string>): string[] {
	return partitionIds(ids, selectedIds, "selected-last");
}

function moveIdsToBack(ids: readonly string[], selectedIds: ReadonlySet<string>): string[] {
	return partitionIds(ids, selectedIds, "selected-first");
}

function partitionIds(
	ids: readonly string[],
	selectedIds: ReadonlySet<string>,
	placement: "selected-first" | "selected-last",
): string[] {
	const selected: string[] = [];
	const unselected: string[] = [];

	for (const id of ids) {
		if (selectedIds.has(id)) {
			selected.push(id);
		} else {
			unselected.push(id);
		}
	}

	return placement === "selected-first"
		? [...selected, ...unselected]
		: [...unselected, ...selected];
}

function assertNever(value: never): never {
	throw new Error(`Unexpected layer action: ${String(value)}`);
}
