export type StrokeControlsMode = "brush" | "selection";

export interface StrokeControlsState {
	isDrawingEnabled: boolean;
	selectedStrokeCount: number;
}

export function shouldShowStrokeControls(state: StrokeControlsState): boolean {
	return state.isDrawingEnabled || state.selectedStrokeCount > 0;
}

export function getStrokeControlsMode(state: StrokeControlsState): StrokeControlsMode {
	return !state.isDrawingEnabled && state.selectedStrokeCount > 0 ? "selection" : "brush";
}

export function getStrokeControlsGroupLabel(mode: StrokeControlsMode): string {
	return mode === "selection"
		? "Selected stroke size, color, stroke settings, and opacity"
		: "Brush size, color, stroke settings, and opacity";
}

export function getStrokeColorButtonLabel(mode: StrokeControlsMode, isOpen: boolean): string {
	if (mode === "selection") {
		return isOpen ? "Close selected stroke color" : "Open selected stroke color";
	}

	return isOpen ? "Close stroke color" : "Open stroke color";
}

export function getStrokeSettingsButtonLabel(mode: StrokeControlsMode, isOpen: boolean): string {
	if (mode === "selection") {
		return isOpen ? "Close selected stroke and handwriting settings" : "Open selected stroke and handwriting settings";
	}

	return isOpen ? "Close stroke and handwriting settings" : "Open stroke and handwriting settings";
}

export function getStrokeSizeSliderLabel(mode: StrokeControlsMode): string {
	return mode === "selection" ? "Selected stroke size" : "Brush size";
}

export function getStrokeOpacitySliderLabel(mode: StrokeControlsMode): string {
	return mode === "selection" ? "Selected stroke opacity" : "Brush opacity";
}
