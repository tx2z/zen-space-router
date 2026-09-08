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
