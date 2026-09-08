"use strict";

// Structural checks on the extension's static files: manifest shape and
// script load order. The built package contents (which files actually end
// up in the zip) are asserted by CI, not here.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

function assertScriptOrder(htmlRelPath, ownScript) {
  const html = fs.readFileSync(path.join(ROOT, htmlRelPath), "utf8");
  const libIndex = html.indexOf('<script src="lib/rules.js">');
  const ownIndex = html.indexOf(`<script src="${ownScript}">`);
  assert.notEqual(libIndex, -1, `${htmlRelPath} must load lib/rules.js`);
  assert.notEqual(ownIndex, -1, `${htmlRelPath} must load ${ownScript}`);
  assert.ok(libIndex < ownIndex, `${htmlRelPath} must load lib/rules.js before ${ownScript}`);
}

test("manifest.json parses as valid JSON", () => {
  assert.doesNotThrow(() => readJson("manifest.json"));
});

test("background.scripts loads lib/rules.js before background.js", () => {
  const manifest = readJson("manifest.json");
  assert.deepEqual(manifest.background.scripts, ["lib/rules.js", "background.js"]);
});

test("picker.html loads lib/rules.js before picker.js", () => {
  assertScriptOrder("picker.html", "picker.js");
});

test("options.html loads lib/rules.js before options.js", () => {
  assertScriptOrder("options.html", "options.js");
});

test("manifest version matches package.json version", () => {
  const manifest = readJson("manifest.json");
  const pkg = readJson("package.json");
  assert.equal(manifest.version, pkg.version);
});

test("updates.json parses as valid JSON", () => {
  assert.doesNotThrow(() => readJson("updates.json"));
});

test("updates.json has an entry for the manifest's addon id", () => {
  const manifest = readJson("manifest.json");
  const updates = readJson("updates.json");
  const addonId = manifest.browser_specific_settings.gecko.id;
  assert.ok(updates.addons[addonId], `updates.json must have an entry for ${addonId}`);
});

test("every updates.json entry has a semver version and a matching https update_link", () => {
  const manifest = readJson("manifest.json");
  const updates = readJson("updates.json");
  const addonId = manifest.browser_specific_settings.gecko.id;
  const entries = updates.addons[addonId].updates;
  assert.ok(entries.length > 0, "updates.json must have at least one update entry");
  const semverRe = /^\d+\.\d+\.\d+$/;
  for (const entry of entries) {
    assert.match(entry.version, semverRe, `${entry.version} must be a semver-like version`);
    assert.match(entry.update_link, /^https:\/\//, `${entry.update_link} must be an https URL`);
    assert.equal(
      entry.update_link,
      `https://github.com/tx2z/zen-space-router/releases/download/v${entry.version}/zen-space-router-${entry.version}.xpi`,
      `update_link for ${entry.version} must point at the matching release tag and asset name`,
    );
  }
});

test("manifest version is present in updates.json", () => {
  const manifest = readJson("manifest.json");
  const updates = readJson("updates.json");
  const addonId = manifest.browser_specific_settings.gecko.id;
  const entries = updates.addons[addonId].updates;
  assert.ok(
    entries.some((entry) => entry.version === manifest.version),
    `updates.json must have an entry for the current manifest version (${manifest.version})`,
  );
});

test("updates.json versions are unique", () => {
  const manifest = readJson("manifest.json");
  const updates = readJson("updates.json");
  const addonId = manifest.browser_specific_settings.gecko.id;
  const versions = updates.addons[addonId].updates.map((entry) => entry.version);
  assert.equal(new Set(versions).size, versions.length, "updates.json must not have duplicate versions");
});
