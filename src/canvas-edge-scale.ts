export function getTinyCanvasEdgeVisualScale(canvasUnitsPerPixel: number): number {
	if (!Number.isFinite(canvasUnitsPerPixel) || canvasUnitsPerPixel <= 0) {
		return 1;
	}

	return Math.min(1, canvasUnitsPerPixel);
}
