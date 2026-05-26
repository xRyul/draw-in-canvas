import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const testDirname = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(resolve(testDirname, "../styles.css"), "utf8");

function getRuleBodiesContainingSelector(selector: string): string[] {
	const bodies: string[] = [];

	for (const rule of styles.split("}")) {
		const [selectorList, body] = rule.split("{");

		if (selectorList === undefined || body === undefined) {
			continue;
		}

		const selectors = selectorList.replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((item) => item.trim());

		if (selectors.includes(selector)) {
			bodies.push(body);
		}
	}

	assert.ok(bodies.length > 0, `Expected styles.css to contain rule for ${selector}`);
	return bodies;
}

function assertSelectorHasStyle(selector: string, pattern: RegExp): void {
	const bodies = getRuleBodiesContainingSelector(selector);
	assert.ok(bodies.some((body) => pattern.test(body)), `Expected ${selector} to match ${pattern}`);
}

void test("tiny canvas edge visuals use clamped scale variables", () => {
	assertSelectorHasStyle(".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-edges path.canvas-display-path", /stroke-width:\s*var\(--draw-in-canvas-tiny-edge-width,\s*2px\);/);
	assertSelectorHasStyle(".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-edges polygon.canvas-path-end", /stroke-width:\s*1px;/);
	assertSelectorHasStyle(".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-edges polygon.canvas-path-end", /transform:\s*scale\(var\(--draw-in-canvas-tiny-edge-arrow-scale,\s*1\)\);/);
	assertSelectorHasStyle(".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-edges g.is-focused path.canvas-display-path", /stroke-width:\s*var\(--draw-in-canvas-tiny-edge-focus-width,\s*5\.5px\);/);
});

void test("tiny canvas edge hit targets stay usable while visual edges shrink", () => {
	assertSelectorHasStyle(
		".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-edges path.canvas-interaction-path",
		/stroke-width:\s*var\(--draw-in-canvas-tiny-edge-hit-width,\s*calc\(24px \* var\(--zoom-multiplier\)\)\);/,
	);
});
