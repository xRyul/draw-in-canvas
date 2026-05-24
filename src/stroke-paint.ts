export interface VisibleStrokePaintPath {
	readonly classList: Pick<DOMTokenList, "contains">;
	setAttribute(name: string, value: string): void;
}

export function updateVisibleStrokePaintAttributes(pathEl: VisibleStrokePaintPath, color: string): void {
	if (pathEl.classList.contains("mod-handwritten")) {
		pathEl.setAttribute("fill", color);
		return;
	}

	pathEl.setAttribute("stroke", color);
}
