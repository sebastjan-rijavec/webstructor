#!/usr/bin/env node
// Post-bump release publisher.
//
// Runs after `commit-and-tag-version` has bumped package.json, regenerated
// CHANGELOG.md, and created the version tag locally. This script then:
//   1. pushes the new commit + tag to origin/main
//   2. creates a GitHub Release for the tag with auto-generated notes
//   3. deploys to the home server
//
// Cross-platform (Node) so it works the same on macOS, Linux, and Windows.
// Invoked via `npm run release:publish`, which is chained from
// `release:patch / minor / major`.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const tag = `v${pkg.version}`;

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

run("git push --follow-tags origin main");
run(`gh release create ${tag} --generate-notes --title ${tag}`);
run("npm run deploy");

console.log(`\n✓ Released ${tag}`);
