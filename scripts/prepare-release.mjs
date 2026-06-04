#!/usr/bin/env node

/**
 * Bump release metadata, commit it, and push a matching semver tag.
 *
 * Usage:
 *   pnpm pre-release 0.1.8
 *   pnpm pre-release v0.1.8
 */

import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

const versionArg = process.argv[2];

if (!versionArg) {
	console.error("❌ Please provide a version number: pnpm pre-release X.Y.Z");
	process.exit(1);
}

if (!/^v?\d+\.\d+\.\d+$/.test(versionArg)) {
	console.error("❌ Version must be in format X.Y.Z or vX.Y.Z");
	process.exit(1);
}

const cleanVersion = versionArg.replace(/^v/, "");
const tagName = cleanVersion;
const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "manifest.json");
const packageJsonPath = path.join(repoRoot, "package.json");
const versionsPath = path.join(repoRoot, "versions.json");

let createdTag = false;

try {
	const status = git(["status", "--porcelain"]);
	if (status.trim()) {
		console.error("⚠️  You have uncommitted changes. Please commit or stash them first.");
		console.error("\nUncommitted files:");
		console.error(status);
		process.exit(1);
	}

	const currentBranch = git(["branch", "--show-current"]).trim();
	if (!currentBranch) {
		console.error("❌ Unable to determine current branch. Are you on a detached HEAD?");
		process.exit(1);
	}

	if (tagExistsLocally(tagName)) {
		console.error(`❌ Tag ${tagName} already exists locally.`);
		console.error(`   To delete it: git tag -d ${tagName}`);
		process.exit(1);
	}

	if (tagExistsOnRemote(tagName)) {
		console.error(`❌ Tag ${tagName} already exists on remote.`);
		console.error("   This version has already been released.");
		process.exit(1);
	}

	console.log("📡 Fetching latest from remote...");
	git(["fetch"], {stdio: "inherit"});

	const remoteBranch = `origin/${currentBranch}`;
	try {
		const behind = git(["rev-list", `HEAD..${remoteBranch}`, "--count"]).trim();
		if (behind !== "0") {
			console.error(`❌ Your branch is ${behind} commits behind ${remoteBranch}.`);
			console.error("   Please pull or rebase first, then try again.");
			process.exit(1);
		}
	} catch {
		// If the remote branch does not exist, let the push step report the error.
	}

	const manifestMeta = readJson(manifestPath);
	const packageMeta = readJson(packageJsonPath);
	const versionsMeta = existsSync(versionsPath) ? readJson(versionsPath) : null;

	if (manifestMeta.json.version !== packageMeta.json.version) {
		console.error("❌ manifest.json and package.json versions do not match.");
		console.error(`   manifest.json: ${manifestMeta.json.version}`);
		console.error(`   package.json:  ${packageMeta.json.version}`);
		process.exit(1);
	}

	if (compareSemver(cleanVersion, packageMeta.json.version) <= 0) {
		console.error(`❌ New version ${cleanVersion} must be greater than current version ${packageMeta.json.version}.`);
		process.exit(1);
	}

	console.log("\n📦 Current version:", packageMeta.json.version);
	console.log("🚀 Preparing release:", cleanVersion);

	manifestMeta.json.version = cleanVersion;
	packageMeta.json.version = cleanVersion;

	const minAppVersion = manifestMeta.json.minAppVersion ?? "1.5.0";
	const versions = versionsMeta?.json ?? {};
	versions[cleanVersion] = minAppVersion;

	writeJson(manifestPath, manifestMeta.json, manifestMeta.indent, manifestMeta.eol);
	writeJson(packageJsonPath, packageMeta.json, packageMeta.indent, packageMeta.eol);
	writeJson(versionsPath, versions, versionsMeta?.indent ?? manifestMeta.indent, versionsMeta?.eol ?? manifestMeta.eol);

	git(["add", "manifest.json", "package.json", "versions.json"], {stdio: "inherit"});
	git(["commit", "-m", `Release: bump version to ${cleanVersion}`], {stdio: "inherit"});

	console.log("\n📤 Pushing version bump commit...");
	git(["push", "origin", currentBranch], {stdio: "inherit"});

	git(["tag", "-a", tagName, "-m", `Release ${cleanVersion}`], {stdio: "inherit"});
	createdTag = true;
	console.log(`✅ Created tag ${tagName}`);

	console.log("\n📤 Pushing tag to remote...");
	git(["push", "origin", tagName], {stdio: "inherit"});
	console.log(`✅ Pushed tag ${tagName} to remote`);

	console.log(`\n🎉 Release ${tagName} prepared successfully.`);
	console.log("GitHub Actions will build the plugin and upload main.js, manifest.json, and styles.css.");
} catch (error) {
	console.error("\n❌ Error during release preparation:", error?.message ?? error);

	if (createdTag) {
		try {
			git(["tag", "-d", tagName], {stdio: "pipe"});
			console.log("🧹 Cleaned up local tag");
		} catch {
			// Ignore cleanup failures.
		}
	}

	process.exit(1);
}

function readJson(filePath) {
	const content = readFileSync(filePath, "utf8");
	return {
		content,
		json: JSON.parse(content),
		indent: detectIndent(content),
		eol: detectEol(content),
	};
}

function writeJson(filePath, json, indent, eol) {
	writeFileSync(filePath, `${JSON.stringify(json, null, indent)}${eol}`);
}

function detectIndent(content) {
	return content.includes("\t") ? "\t" : "  ";
}

function detectEol(content) {
	return content.includes("\r\n") ? "\r\n" : "\n";
}

function git(args, options = {}) {
	const output = execFileSync("git", args, {encoding: "utf8", ...options});
	return typeof output === "string" ? output : "";
}

function tagExistsLocally(tag) {
	try {
		git(["rev-parse", "--verify", `refs/tags/${tag}`], {stdio: "pipe"});
		return true;
	} catch {
		return false;
	}
}

function tagExistsOnRemote(tag) {
	try {
		return git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`], {stdio: "pipe"}).trim().length > 0;
	} catch {
		return false;
	}
}

function compareSemver(a, b) {
	const aParts = a.split(".").map(Number);
	const bParts = b.split(".").map(Number);

	for (let index = 0; index < 3; index++) {
		const diff = (aParts[index] ?? 0) - (bParts[index] ?? 0);
		if (diff !== 0) {
			return diff;
		}
	}

	return 0;
}
