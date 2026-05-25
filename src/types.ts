export const DRAWING_DATA_KEY = "drawInCanvas" as const;
export const DRAWING_DATA_VERSION = 2 as const;
export const COLOR_HISTORY_LIMIT = 10 as const;

export interface StrokePoint {
	x: number;
	y: number;
	pressure?: number;
}

export interface CanvasStrokeHandwriting {
	enabled: boolean;
	thinning: number;
	streamline: number;
	smoothing: number;
	taperStart: number;
	taperEnd: number;
}

export interface CanvasStroke {
	id: string;
	color: string;
	width: number;
	hardness: number;
	opacity: number;
	points: StrokePoint[];
	handwriting: CanvasStrokeHandwriting;
	createdAt: number;
}

export interface CanvasDrawingData {
	version: typeof DRAWING_DATA_VERSION;
	strokes: CanvasStroke[];
	colorHistory: string[];
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
		colorHistory: [],
	};
}

export function createStrokeId(): string {
	return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function roundCoordinate(value: number): number {
	return Math.round(value * 10000) / 10000;
}

export function normalizeStrokePressure(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}

	const clampedValue = Math.min(1, Math.max(0, value));
	return Math.round(clampedValue * 1000) / 1000;
}

export function pointsToSvgPath(points: readonly StrokePoint[], options: {smooth?: boolean} = {}): string {
	return options.smooth ? pointsToSmoothSvgPath(points) : pointsToLinearSvgPath(points);
}

function pointsToLinearSvgPath(points: readonly StrokePoint[]): string {
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

function pointsToSmoothSvgPath(points: readonly StrokePoint[]): string {
	const firstPoint = points[0];

	if (!firstPoint || points.length < 3) {
		return pointsToLinearSvgPath(points);
	}

	const commands = [`M ${formatCoordinate(firstPoint.x)} ${formatCoordinate(firstPoint.y)}`];

	for (let index = 1; index < points.length - 1; index++) {
		const controlPoint = points[index];
		const nextPoint = points[index + 1];

		if (!controlPoint || !nextPoint) {
			continue;
		}

		const endPoint = {
			x: (controlPoint.x + nextPoint.x) / 2,
			y: (controlPoint.y + nextPoint.y) / 2,
		};

		commands.push(
			`Q ${formatCoordinate(controlPoint.x)} ${formatCoordinate(controlPoint.y)} ${formatCoordinate(endPoint.x)} ${formatCoordinate(endPoint.y)}`,
		);
	}

	const lastPoint = points[points.length - 1];

	if (lastPoint) {
		commands.push(`L ${formatCoordinate(lastPoint.x)} ${formatCoordinate(lastPoint.y)}`);
	}

	return commands.join(" ");
}

function formatCoordinate(value: number): string {
	return roundCoordinate(value).toString();
}
