"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../lib/rules.js");

const { normalizeDomain, findRule, baseDomain, stripBidiControls, CONTAINER_COLORS } = lib;

test("normalizeDomain", async (t) => {
  await t.test("strips scheme, path and port", () => {
    assert.equal(normalizeDomain("https://Example.com:8443/some/path"), "example.com");
  });

  await t.test("lowercases", () => {
    assert.equal(normalizeDomain("EXAMPLE.COM"), "example.com");
  });

  await t.test("converts IDN to punycode", () => {
    assert.equal(normalizeDomain("münchen.de"), "xn--mnchen-3ya.de");
  });

  await t.test("strips a trailing dot", () => {
    assert.equal(normalizeDomain("example.com."), "example.com");
  });

  await t.test("empty input returns null", () => {
    assert.equal(normalizeDomain(""), null);
    assert.equal(normalizeDomain("   "), null);
    assert.equal(normalizeDomain(null), null);
    assert.equal(normalizeDomain(undefined), null);
  });

  await t.test('"__proto__" cannot become an own property of a plain object, so it is rejected', () => {
    assert.equal(normalizeDomain("__proto__"), null);
  });

  await t.test('"constructor" cannot become an own property of a plain object, so it is rejected', () => {
    assert.equal(normalizeDomain("constructor"), null);
  });

  await t.test("single label allowed only for exact use (e.g. localhost)", () => {
    assert.equal(normalizeDomain("localhost"), "localhost");
  });
});

test("findRule", async (t) => {
  await t.test("exact match", () => {
    assert.equal(findRule("example.com", { "example.com": "container-a" }), "container-a");
  });

  await t.test("suffix match", () => {
    assert.equal(findRule("a.b.example.com", { "example.com": "container-a" }), "container-a");
  });

  await t.test("no match on a different domain sharing a suffix", () => {
    assert.equal(findRule("notexample.com", { "example.com": "container-a" }), null);
  });

  await t.test("a TLD-only rule never matches", () => {
    assert.equal(findRule("example.com", { com: "container-a" }), null);
  });

  await t.test("localhost matches exactly", () => {
    assert.equal(findRule("localhost", { localhost: "container-a" }), "container-a");
  });

  await t.test("strips a trailing dot before matching", () => {
    assert.equal(findRule("example.com.", { "example.com": "container-a" }), "container-a");
  });

  await t.test("is case-insensitive", () => {
    assert.equal(findRule("Example.COM", { "example.com": "container-a" }), "container-a");
  });
});

test("baseDomain", async (t) => {
  await t.test("www.facebook.com -> facebook.com", () => {
    assert.equal(baseDomain("www.facebook.com"), "facebook.com");
  });

  await t.test("m.facebook.com -> facebook.com", () => {
    assert.equal(baseDomain("m.facebook.com"), "facebook.com");
  });

  await t.test("a.b.example.co.uk -> example.co.uk", () => {
    assert.equal(baseDomain("a.b.example.co.uk"), "example.co.uk");
  });

  await t.test("localhost is returned unchanged", () => {
    assert.equal(baseDomain("localhost"), "localhost");
  });

  await t.test("IPv4 literal is returned unchanged", () => {
    assert.equal(baseDomain("192.168.1.10"), "192.168.1.10");
  });

  await t.test("IPv6 literal is returned unchanged", () => {
    assert.equal(baseDomain("[::1]"), "[::1]");
  });
});

test("stripBidiControls", () => {
  assert.equal(stripBidiControls("a\u202Eb\u202Cc"), "abc");
  assert.equal(stripBidiControls("plain text"), "plain text");
});

test("CONTAINER_COLORS has gray, grey and toolbar mapped to the same hex", () => {
  assert.equal(CONTAINER_COLORS.gray, CONTAINER_COLORS.grey);
  assert.equal(CONTAINER_COLORS.gray, CONTAINER_COLORS.toolbar);
  assert.equal(typeof CONTAINER_COLORS.gray, "string");
});
