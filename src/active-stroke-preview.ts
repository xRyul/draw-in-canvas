// Benchmarked in Obsidian with attached SVG preview paths. Full handwritten-preview
// recomputation started degrading near 49k active points; an 8192-point live tail with
// 2048-point committed chunks kept update p95 below 4ms through 65k+ points.
export const HANDWRITTEN_ACTIVE_STROKE_PREVIEW_WINDOW_SIZE = 8192;
export const HANDWRITTEN_ACTIVE_STROKE_PREVIEW_CHUNK_SIZE = 2048;

export interface ActiveStrokePreviewChunkPlan {
	startIndex: number;
	endIndex: number;
	nextCommittedPointIndex: number;
}

export function getNextHandwrittenActiveStrokePreviewChunk(
	pointCount: number,
	committedPointIndex: number,
): ActiveStrokePreviewChunkPlan | null {
	return getNextActiveStrokePreviewChunk(
		pointCount,
		committedPointIndex,
		HANDWRITTEN_ACTIVE_STROKE_PREVIEW_WINDOW_SIZE,
		HANDWRITTEN_ACTIVE_STROKE_PREVIEW_CHUNK_SIZE,
	);
}

export function getHandwrittenActiveStrokePreviewTailStartIndex(committedPointIndex: number): number {
	return Math.max(0, committedPointIndex - 1);
}

function getNextActiveStrokePreviewChunk(
	pointCount: number,
	committedPointIndex: number,
	windowSize: number,
	chunkSize: number,
): ActiveStrokePreviewChunkPlan | null {
	if (!Number.isFinite(pointCount)
		|| !Number.isFinite(committedPointIndex)
		|| pointCount - committedPointIndex <= windowSize + chunkSize) {
		return null;
	}

	const startIndex = Math.max(0, Math.floor(committedPointIndex));
	const endIndex = Math.min(startIndex + chunkSize, Math.floor(pointCount));

	if (endIndex - startIndex < 2) {
		return null;
	}

	return {
		startIndex,
		endIndex,
		nextCommittedPointIndex: endIndex,
	};
}
