export const DRAWING_DATA_KEY = "drawInCanvas" as const;
export const DRAWING_DATA_VERSION = 1 as const;

export interface StrokePoint {
	x: number;
	y: number;
}

export interface CanvasStroke {
	id: string;
	color: string;
	width: number;
	points: StrokePoint[];
	createdAt: number;
}

export interface CanvasDrawingData {
	version: typeof DRAWING_DATA_VERSION;
	strokes: CanvasStroke[];
}

export type JsonCanvasDocument = Record<string, unknown> & {
	nodes?: unknown[];
	edges?: unknown[];
	[DRAWING_DATA_KEY]?: CanvasDrawingData;
};

export function createEmptyDrawingData(): CanvasDrawingData {
	return {
		version: DRAWING_DATA_VERSION,
		strokes: [],
	};
}

export function createStrokeId(): string {
	return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function roundCoordinate(value: number): number {
	return Math.round(value * 100) / 100;
}

export function pointsToSvgPath(points: readonly StrokePoint[]): string {
	const firstPoint = points[0];

	if (!firstPoint) {
		return "";
	}

	const commands = [`M ${formatCoordinate(firstPoint.x)} ${formatCoordinate(firstPoint.y)}`];

	if (points.length === 1) {
		commands.push(`L ${formatCoordinate(firstPoint.x + 0.01)} ${formatCoordinate(firstPoint.y + 0.01)}`);
		return commands.join(" ");
	}

	for (let index = 1; index < points.length; index++) {
		const point = points[index];

		if (point) {
			commands.push(`L ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`);
		}
	}

	return commands.join(" ");
}

function formatCoordinate(value: number): string {
	return roundCoordinate(value).toString();
}
