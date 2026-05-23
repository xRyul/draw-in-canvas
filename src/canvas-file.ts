import {App, TFile} from "obsidian";
import {normalizeStrokeHardness, normalizeStrokeOpacity} from "./settings";
import {
	CanvasDrawingData,
	CanvasStroke,
	COLOR_HISTORY_LIMIT,
	DRAWING_DATA_KEY,
	DRAWING_DATA_VERSION,
	JsonCanvasDocument,
	StrokePoint,
	normalizeStrokePressure,
	createEmptyDrawingData,
	createStrokeId,
} from "./types";

export async function loadCanvasDrawingData(app: App, file: TFile): Promise<CanvasDrawingData> {
	const canvasDocument = await readJsonCanvasDocument(app, file);
	return normalizeDrawingData(canvasDocument[DRAWING_DATA_KEY]);
}

export async function saveCanvasDrawingData(app: App, file: TFile, drawingData: CanvasDrawingData): Promise<void> {
	const canvasDocument = await readJsonCanvasDocument(app, file);
	canvasDocument[DRAWING_DATA_KEY] = normalizeDrawingData(drawingData);
	await writeJsonCanvasDocument(app, file, canvasDocument);
}

export async function clearCanvasDrawingData(app: App, file: TFile): Promise<void> {
	const canvasDocument = await readJsonCanvasDocument(app, file);
	delete canvasDocument[DRAWING_DATA_KEY];
	await writeJsonCanvasDocument(app, file, canvasDocument);
}

function normalizeDrawingData(value: unknown): CanvasDrawingData {
	if (!isRecord(value)) {
		return createEmptyDrawingData();
	}

	const rawStrokes = Array.isArray(value.strokes) ? value.strokes : [];
	const strokes = rawStrokes.map(toCanvasStroke).filter(isPresent);
	const colorHistory = toColorHistory(value.colorHistory);

	return {
		version: DRAWING_DATA_VERSION,
		strokes,
		colorHistory,
	};
}

function toColorHistory(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const colorHistory: string[] = [];

	for (const rawColor of value) {
		if (typeof rawColor !== "string") {
			continue;
		}

		const color = normalizeColorHistoryColor(rawColor);

		if (!color || colorHistory.includes(color)) {
			continue;
		}

		colorHistory.push(color);

		if (colorHistory.length >= COLOR_HISTORY_LIMIT) {
			break;
		}
	}

	return colorHistory;
}

function normalizeColorHistoryColor(value: string): string | null {
	const match = /^#?([\da-f]{6})$/i.exec(value.trim());
	const hexValue = match?.[1];

	if (!hexValue) {
		return null;
	}

	return `#${hexValue.toLowerCase()}`;
}

function toCanvasStroke(value: unknown): CanvasStroke | null {
	if (!isRecord(value)) {
		return null;
	}

	const rawPoints = Array.isArray(value.points) ? value.points : [];
	const points = rawPoints.map(toStrokePoint).filter(isPresent);

	if (points.length === 0) {
		return null;
	}

	return {
		id: typeof value.id === "string" && value.id.length > 0 ? value.id : createStrokeId(),
		color: typeof value.color === "string" && value.color.length > 0 ? value.color : "#ff5a5f",
		width: toPositiveNumber(value.width, 4),
		hardness: normalizeStrokeHardness(value.hardness),
		opacity: normalizeStrokeOpacity(value.opacity),
		points,
		createdAt: toPositiveNumber(value.createdAt, Date.now()),
	};
}

function toStrokePoint(value: unknown): StrokePoint | null {
	if (!isRecord(value)) {
		return null;
	}

	if (typeof value.x !== "number" || typeof value.y !== "number") {
		return null;
	}

	if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
		return null;
	}

	const pressure = normalizeStrokePressure(value.pressure);
	const point: StrokePoint = {
		x: value.x,
		y: value.y,
	};

	if (pressure !== undefined) {
		point.pressure = pressure;
	}

	return point;
}

function toPositiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function readJsonCanvasDocument(app: App, file: TFile): Promise<JsonCanvasDocument> {
	const rawFile = await app.vault.read(file);
	const parsedFile: unknown = JSON.parse(rawFile || "{}");

	if (!isRecord(parsedFile)) {
		throw new Error("Canvas file did not contain a JSON object.");
	}

	return parsedFile;
}

async function writeJsonCanvasDocument(app: App, file: TFile, canvasDocument: JsonCanvasDocument): Promise<void> {
	await app.vault.modify(file, `${JSON.stringify(canvasDocument, null, "\t")}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent<T>(value: T | null): value is T {
	return value !== null;
}
