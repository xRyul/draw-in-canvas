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

void test("tiny canvas node resize handles clamp their canvas-unit layout size for browser hit-test precision", () => {
	assertSelectorHasStyle(
		".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-node-resizer",
		/--draw-in-canvas-tiny-resizer-layout-size:\s*max\(/,
	);
	assertSelectorHasStyle(
		".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-node-resizer",
		/var\(--draw-in-canvas-tiny-resizer-min-layout-size,\s*0\.022px\)/,
	);
	assertSelectorHasStyle(
		".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-node-resizer",
		/width:\s*var\(--draw-in-canvas-tiny-resizer-layout-size\);/,
	);
});

void test("tiny canvas node resize handles keep offsets centered on exact card borders", () => {
	assertSelectorHasStyle(
		".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-node-resizer[data-resize=\"top\"]",
		/top:\s*calc\(var\(--draw-in-canvas-tiny-resizer-layout-size\) \/ -2\);/,
	);
	assertSelectorHasStyle(
		".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-node-resizer[data-resize=\"right\"]",
		/right:\s*calc\(var\(--draw-in-canvas-tiny-resizer-layout-size\) \/ -2\);/,
	);
	assertSelectorHasStyle(
		".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-node-resizer[data-resize=\"topright\"]",
		/z-index:\s*1;/,
	);
});
