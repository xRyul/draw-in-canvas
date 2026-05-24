import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const testDirname = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(resolve(testDirname, "../styles.css"), "utf8");

function getRuleBody(selector: string): string {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "m").exec(styles);

	assert.ok(match, `Expected styles.css to contain rule for ${selector}`);
	return match[1] ?? "";
}

void test("tiny image canvas nodes do not keep Obsidian image embed padding", () => {
	const body = getRuleBody(".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-node-content.media-embed.image-embed");

	assert.match(body, /width:\s*100%;/);
	assert.match(body, /height:\s*100%;/);
	assert.match(body, /min-width:\s*0;/);
	assert.match(body, /min-height:\s*0;/);
	assert.match(body, /padding:\s*0;/);
});

void test("tiny image canvas node images fit inside the resized card", () => {
	const body = getRuleBody(".canvas-wrapper.draw-in-canvas-tiny-control-scale .canvas-node-content.media-embed.image-embed > img");

	assert.match(body, /width:\s*100%;/);
	assert.match(body, /height:\s*100%;/);
	assert.match(body, /max-width:\s*none;/);
	assert.match(body, /max-height:\s*none;/);
	assert.match(body, /object-fit:\s*contain;/);
	assert.match(body, /object-position:\s*center;/);
});
