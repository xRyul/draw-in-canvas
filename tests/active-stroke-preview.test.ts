import assert from "node:assert/strict";
import test from "node:test";

import {
	HANDWRITTEN_ACTIVE_STROKE_PREVIEW_CHUNK_SIZE,
	HANDWRITTEN_ACTIVE_STROKE_PREVIEW_WINDOW_SIZE,
	getHandwrittenActiveStrokePreviewTailStartIndex,
	getNextHandwrittenActiveStrokePreviewChunk,
} from "../src/active-stroke-preview.ts";

void test("handwritten preview keeps one live path while below the benchmarked chunk threshold", () => {
	const threshold = HANDWRITTEN_ACTIVE_STROKE_PREVIEW_WINDOW_SIZE + HANDWRITTEN_ACTIVE_STROKE_PREVIEW_CHUNK_SIZE;

	assert.equal(getNextHandwrittenActiveStrokePreviewChunk(threshold, 0), null);
});

void test("handwritten preview commits a fixed-size chunk after the live tail exceeds the safe window", () => {
	const pointCount = HANDWRITTEN_ACTIVE_STROKE_PREVIEW_WINDOW_SIZE
		+ HANDWRITTEN_ACTIVE_STROKE_PREVIEW_CHUNK_SIZE
		+ 1;

	assert.deepEqual(getNextHandwrittenActiveStrokePreviewChunk(pointCount, 0), {
		startIndex: 0,
		endIndex: HANDWRITTEN_ACTIVE_STROKE_PREVIEW_CHUNK_SIZE,
		nextCommittedPointIndex: HANDWRITTEN_ACTIVE_STROKE_PREVIEW_CHUNK_SIZE,
	});
});

void test("handwritten preview tail overlaps the previous chunk by one point for continuity", () => {
	assert.equal(getHandwrittenActiveStrokePreviewTailStartIndex(0), 0);
	assert.equal(
		getHandwrittenActiveStrokePreviewTailStartIndex(HANDWRITTEN_ACTIVE_STROKE_PREVIEW_CHUNK_SIZE),
		HANDWRITTEN_ACTIVE_STROKE_PREVIEW_CHUNK_SIZE - 1,
	);
});
