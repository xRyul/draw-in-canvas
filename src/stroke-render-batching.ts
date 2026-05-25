// Benchmarked in Obsidian after removing transparent hit-test paths:
// - One SVG path per visible stroke degraded around 1,000-1,500 dense visible strokes.
// - Consecutive visually equivalent opaque/unfiltered strokes batched into one path stayed
//   far under the frame budget through 20k visible strokes in the benchmark.
// - Translucent or blurred strokes stay unbatched because SVG opacity/filter compositing
//   would change overlap rendering; dense unbatchable plans are handled by raster fallback.
export interface StrokeRenderBatchStyle {
	kind: "linear" | "handwritten";
	color: string;
	opacity: string;
	blurRadius: number;
	width?: number;
}

export function getStrokeRenderBatchKeyForStyle(style: StrokeRenderBatchStyle): string | null {
	if (style.opacity !== "1" || style.blurRadius > 0) {
		return null;
	}

	if (style.kind === "handwritten") {
		return ["handwritten", style.color].join("|");
	}

	if (typeof style.width !== "number" || !Number.isFinite(style.width)) {
		return null;
	}

	return ["linear", style.color, style.width].join("|");
}

export interface StrokeRenderBatchCandidate {
	id: string;
	batchKey: string | null;
	isSelected: boolean;
}

export type StrokeRenderItem =
	| {type: "single"; strokeId: string}
	| {type: "batch"; strokeIds: string[]; batchKey: string};

export function getStrokeRenderItems(candidates: readonly StrokeRenderBatchCandidate[]): StrokeRenderItem[] {
	const items: StrokeRenderItem[] = [];
	let pendingBatchKey: string | null = null;
	let pendingStrokeIds: string[] = [];

	const flushPendingBatch = (): void => {
		if (pendingStrokeIds.length === 0) {
			return;
		}

		if (pendingStrokeIds.length === 1 || pendingBatchKey === null) {
			items.push(...pendingStrokeIds.map((strokeId) => ({type: "single" as const, strokeId})));
		} else {
			items.push({type: "batch", strokeIds: pendingStrokeIds, batchKey: pendingBatchKey});
		}

		pendingStrokeIds = [];
		pendingBatchKey = null;
	};

	for (const candidate of candidates) {
		if (candidate.isSelected || candidate.batchKey === null) {
			flushPendingBatch();
			items.push({type: "single", strokeId: candidate.id});
			continue;
		}

		if (pendingBatchKey !== null && pendingBatchKey !== candidate.batchKey) {
			flushPendingBatch();
		}

		pendingBatchKey = candidate.batchKey;
		pendingStrokeIds.push(candidate.id);
	}

	flushPendingBatch();
	return items;
}
