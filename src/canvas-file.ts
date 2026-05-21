import {App, TFile} from "obsidian";
import {
	CanvasDrawingData,
	CanvasStroke,
	DRAWING_DATA_KEY,
	DRAWING_DATA_VERSION,
	JsonCanvasDocument,
	StrokePoint,
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

	return {
		version: DRAWING_DATA_VERSION,
		strokes,
	};
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

	return {
		x: value.x,
		y: value.y,
	};
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
