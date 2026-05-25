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

void test("canvas reset zoom control shows 100% text instead of the icon", () => {
	assertSelectorHasStyle(".canvas-controls .canvas-control-item[aria-label^=\"Reset zoom\"] svg", /visibility:\s*hidden;/);
	assertSelectorHasStyle(".canvas-controls .canvas-control-item[aria-label^=\"Reset zoom\"]::before", /content:\s*"100%";/);
});

void test("canvas fit control shows Fit text instead of the icon", () => {
	assertSelectorHasStyle(".canvas-controls .canvas-control-item[aria-label^=\"Zoom to fit\"] svg", /visibility:\s*hidden;/);
	assertSelectorHasStyle(".canvas-controls .canvas-control-item[aria-label^=\"Fit\"] svg", /visibility:\s*hidden;/);
	assertSelectorHasStyle(".canvas-controls .canvas-control-item[aria-label^=\"Zoom to fit\"]::before", /content:\s*"Fit";/);
	assertSelectorHasStyle(".canvas-controls .canvas-control-item[aria-label^=\"Fit\"]::before", /content:\s*"Fit";/);
});

void test("canvas text zoom labels do not change native button width", () => {
	const resetButtonStyles = getRuleBodiesContainingSelector(".canvas-controls .canvas-control-item[aria-label^=\"Reset zoom\"]").join("\n");

	assert.doesNotMatch(resetButtonStyles, /display:\s*(flex|grid|inline-flex|inline-grid);/);
	assertSelectorHasStyle(".canvas-controls .canvas-control-item[aria-label^=\"Reset zoom\"]::before", /position:\s*absolute;/);
	assertSelectorHasStyle(".canvas-controls .canvas-control-item[aria-label^=\"Reset zoom\"]::before", /inset:\s*0;/);
});
