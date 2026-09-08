"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const { createFakeBrowser } = require("./helpers/fake-browser.js");

const BACKGROUND_PATH = require.resolve("../background.js");
const RULES_PATH = require.resolve("../lib/rules.js");
const RULES_SOURCE = fs.readFileSync(RULES_PATH, "utf8");

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Runs lib/rules.js the way a manifest `background.scripts`/`<script>` load
// would: outside any CommonJS module scope, so its own "not a module"
// branch is what installs the ZenSpaceRouterLib global, not this test file.
function installRulesLibGlobal() {
  delete global.ZenSpaceRouterLib;
  vm.runInThisContext(RULES_SOURCE, { filename: RULES_PATH });
  assert.notEqual(
    global.ZenSpaceRouterLib,
    undefined,
    "lib/rules.js must install the ZenSpaceRouterLib global itself when loaded as a classic script"
  );
}

// Requires a fresh copy of background.js wired to the given fake browser and
// waits for its initial settings load, then registers teardown of the
// globals/require cache and a check that every tabs.get call this test made
// hit a tab the test had actually registered.
async function loadBackground(t, fakeBrowser) {
  delete require.cache[BACKGROUND_PATH];
  global.browser = fakeBrowser;
  installRulesLibGlobal();

  const bg = require(BACKGROUND_PATH);
  await bg.settingsReady;

  t.after(() => {
    delete require.cache[BACKGROUND_PATH];
    delete global.browser;
    delete global.ZenSpaceRouterLib;
    assert.equal(
      fakeBrowser._calls.tabsGetMisses,
      0,
      "tabs.get should never miss a tab this test did not register"
    );
  });

  return bg;
}

function fireOnCreated(fakeBrowser, tab) {
  for (const listener of fakeBrowser.tabs.onCreated.listeners) {
    listener(tab);
  }
}

function getOnBeforeRequestListener(fakeBrowser) {
  return fakeBrowser.webRequest.onBeforeRequest.listeners[0];
}

function getOnMessageListener(fakeBrowser) {
  return fakeBrowser.runtime.onMessage.listeners[0];
}

function registerFreshTab(fakeBrowser, tabId, overrides) {
  fakeBrowser._results.tabsGet.set(tabId, {
    id: tabId,
    url: "about:blank",
    openerTabId: undefined,
    cookieStoreId: "firefox-default",
    windowId: 1,
    index: 0,
    ...overrides,
  });
  fireOnCreated(fakeBrowser, { id: tabId, url: "about:blank", openerTabId: undefined, active: false });
}

const PICKER_URL_PREFIX = "moz-extension://fake-id/picker.html";

test("external tab with no matching rule is sent to the picker", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const tabId = 1;
  registerFreshTab(fakeBrowser, tabId);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, { cancel: true });
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 1);
  assert.equal(fakeBrowser._calls.tabsUpdate[0].tabId, tabId);
  assert.equal(fakeBrowser._calls.tabsUpdate[0].details.active, true);
  assert.ok(fakeBrowser._calls.tabsUpdate[0].details.url.startsWith(PICKER_URL_PREFIX));
});

test("navigateToPicker encodes the intercepted url in the picker query string", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const tabId = 60;
  registerFreshTab(fakeBrowser, tabId);

  const url = "https://example.com/a path?q=1&x=2";
  const listener = getOnBeforeRequestListener(fakeBrowser);
  await listener({ tabId, url, originUrl: undefined, documentUrl: undefined });

  assert.ok(fakeBrowser._calls.tabsUpdate[0].details.url.includes("url=" + encodeURIComponent(url)));
});

test("external tab with a rule for a different container is routed and the source tab is closed", async (t) => {
  const fakeBrowser = createFakeBrowser();
  fakeBrowser._storageData.rules = { "example.com": "container-b" };
  await loadBackground(t, fakeBrowser);

  const tabId = 2;
  registerFreshTab(fakeBrowser, tabId);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, { cancel: true });
  assert.equal(fakeBrowser._calls.tabsCreate.length, 1);
  assert.equal(fakeBrowser._calls.tabsCreate[0].cookieStoreId, "container-b");
  assert.equal(fakeBrowser._calls.tabsRemove.length, 1);
  assert.equal(fakeBrowser._calls.tabsRemove[0], tabId);
});

test("rule matching the tab's current container is a no-op", async (t) => {
  const fakeBrowser = createFakeBrowser();
  fakeBrowser._storageData.rules = { "example.com": "firefox-default" };
  await loadBackground(t, fakeBrowser);

  const tabId = 3;
  registerFreshTab(fakeBrowser, tabId);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, {});
  assert.equal(fakeBrowser._calls.tabsCreate.length, 0);
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 0);
  assert.equal(fakeBrowser._calls.tabsRemove.length, 0);
});

test("a request carrying originUrl on a fresh tab is page-initiated and passed through synchronously", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const tabId = 4;
  registerFreshTab(fakeBrowser, tabId);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = listener({
    tabId,
    url: "https://example.com/",
    originUrl: "https://other.example/",
    documentUrl: undefined,
  });

  assert.deepEqual(result, {});
  assert.equal(fakeBrowser._calls.tabsCreate.length, 0);
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 0);
});

test("a request carrying documentUrl on a fresh tab is page-initiated and passed through synchronously", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const tabId = 41;
  registerFreshTab(fakeBrowser, tabId);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: "https://other.example/frame",
  });

  assert.deepEqual(result, {});
  assert.equal(fakeBrowser._calls.tabsCreate.length, 0);
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 0);
});

test("fresh active tab with routeTypedUrls false is not routed to the picker for a typed URL", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const tabId = 5;
  fakeBrowser._results.tabsGet.set(tabId, {
    id: tabId,
    url: "about:blank",
    openerTabId: undefined,
    cookieStoreId: "firefox-default",
    windowId: 1,
    index: 0,
  });
  fireOnCreated(fakeBrowser, { id: tabId, url: "about:blank", openerTabId: undefined, active: true });

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, {});
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 0);
});

test("fresh active tab with routeTypedUrls true is sent to the picker for a typed URL", async (t) => {
  const fakeBrowser = createFakeBrowser();
  fakeBrowser._storageData.routeTypedUrls = true;
  await loadBackground(t, fakeBrowser);

  const tabId = 6;
  fakeBrowser._results.tabsGet.set(tabId, {
    id: tabId,
    url: "about:blank",
    openerTabId: undefined,
    cookieStoreId: "firefox-default",
    windowId: 1,
    index: 0,
  });
  fireOnCreated(fakeBrowser, { id: tabId, url: "about:blank", openerTabId: undefined, active: true });

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, { cancel: true });
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 1);
});

test("a tab with an openerTabId is not considered fresh", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const tabId = 42;
  fakeBrowser._results.tabsGet.set(tabId, {
    id: tabId,
    url: "about:blank",
    openerTabId: 7,
    cookieStoreId: "firefox-default",
    windowId: 1,
    index: 0,
  });
  fireOnCreated(fakeBrowser, { id: tabId, url: "about:blank", openerTabId: 7, active: false });

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, {});
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 0);
});

test("non-http(s) protocols are never intercepted, even on a fresh tab", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const tabId = 43;
  fireOnCreated(fakeBrowser, { id: tabId, url: "about:blank", openerTabId: undefined, active: false });

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = listener({
    tabId,
    url: "ftp://example.com/file",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, {});
  assert.equal(fakeBrowser._calls.tabsCreate.length, 0);
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 0);
});

test("onBeforeRequest is registered blocking, for main_frame requests only", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const registration = fakeBrowser.webRequest.onBeforeRequest.registrations[0];
  assert.deepEqual(registration.filter, { urls: ["<all_urls>"], types: ["main_frame"] });
  assert.deepEqual(registration.extraInfoSpec, ["blocking"]);
});

test("own-tab guard: a fresh registration is consumed and treated as our own navigation", async (t) => {
  const fakeBrowser = createFakeBrowser();
  const bg = await loadBackground(t, fakeBrowser);

  const url = "https://example.com/own";
  bg.registerOwnPendingUrl(url);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = listener({ tabId: 7, url, originUrl: undefined, documentUrl: undefined });

  assert.deepEqual(result, {});
  assert.equal(bg.consumeOwnPendingUrl(url), false, "the registration should already have been consumed");
});

test("own-tab guard: an expired registration is discarded, not treated as our own navigation", async (t) => {
  const fakeBrowser = createFakeBrowser();
  const bg = await loadBackground(t, fakeBrowser);

  const url = "https://example.com/expired";
  bg.ownPendingUrls.set(url, [Date.now() - 6000]);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  // tabId 99 was never seen by tabs.onCreated, so falling through the
  // (now-discarded) own-pending guard lands on the "not a fresh tab" guard.
  const result = listener({ tabId: 99, url, originUrl: undefined, documentUrl: undefined });

  assert.deepEqual(result, {});
  assert.equal(bg.ownPendingUrls.has(url), false);
});

test("ownTabs guard: a redirect-chain request on an extension-created tab is ignored", async (t) => {
  const fakeBrowser = createFakeBrowser();
  fakeBrowser._storageData.rules = { "example.com": "container-b" };
  await loadBackground(t, fakeBrowser);

  const tabId = 44;
  registerFreshTab(fakeBrowser, tabId);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const routed = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });
  assert.deepEqual(routed, { cancel: true });
  assert.equal(fakeBrowser._calls.tabsCreate.length, 1);

  const newTabId = 1000 + fakeBrowser._calls.tabsCreate.length;
  const redirectResult = listener({
    tabId: newTabId,
    url: "https://example.com/redirect",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(redirectResult, {});
});

test("settings.enabled false disables interception entirely", async (t) => {
  const fakeBrowser = createFakeBrowser();
  fakeBrowser._storageData.enabled = false;
  await loadBackground(t, fakeBrowser);

  const tabId = 8;
  fireOnCreated(fakeBrowser, { id: tabId, url: "about:blank", openerTabId: undefined, active: false });

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, {});
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 0);
});

test("tabs.update rejecting while navigating to the picker still allows navigation through", async (t) => {
  const fakeBrowser = createFakeBrowser();
  fakeBrowser._results.tabsUpdate.push(async () => {
    throw new Error("tabs.update failed");
  });
  await loadBackground(t, fakeBrowser);

  const tabId = 9;
  registerFreshTab(fakeBrowser, tabId);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, {});
});

test("a stale fresh-tab registration (older than 10s) is ignored", async (t) => {
  const fakeBrowser = createFakeBrowser();
  const bg = await loadBackground(t, fakeBrowser);

  const tabId = 50;
  bg.freshTabs.set(tabId, { createdAt: Date.now() - 11000, active: false });

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, {});
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 0);
  assert.equal(bg.freshTabs.has(tabId), false);
});

test("when tabs.create rejects, routing falls back to the picker instead of throwing", async (t) => {
  const fakeBrowser = createFakeBrowser();
  fakeBrowser._storageData.rules = { "example.com": "container-b" };
  fakeBrowser._results.tabsCreate.push(async () => {
    throw new Error("container gone");
  });
  await loadBackground(t, fakeBrowser);

  const tabId = 45;
  registerFreshTab(fakeBrowser, tabId);

  const listener = getOnBeforeRequestListener(fakeBrowser);
  const result = await listener({
    tabId,
    url: "https://example.com/",
    originUrl: undefined,
    documentUrl: undefined,
  });

  assert.deepEqual(result, { cancel: true });
  assert.equal(fakeBrowser._calls.tabsUpdate.length, 1);
  assert.ok(fakeBrowser._calls.tabsUpdate[0].details.url.startsWith(PICKER_URL_PREFIX));
});

test("storage.onChanged only reacts to areaName 'local'", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const messageListener = getOnMessageListener(fakeBrowser);

  for (const listener of fakeBrowser.storage.onChanged.listeners) {
    listener({ enabled: { oldValue: true, newValue: false } }, "sync");
  }
  await flush();
  const afterSync = await messageListener({ type: "getSettings" }, {});
  assert.equal(afterSync.enabled, true, "a 'sync' area change must not affect in-memory settings");

  fakeBrowser._storageData.enabled = false;
  for (const listener of fakeBrowser.storage.onChanged.listeners) {
    listener({ enabled: { oldValue: true, newValue: false } }, "local");
  }
  await flush();
  const afterLocal = await messageListener({ type: "getSettings" }, {});
  assert.equal(afterLocal.enabled, false, "a 'local' area change must reload settings");
});

test("storage.local.set triggers onChanged listeners for the 'local' area", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const messageListener = getOnMessageListener(fakeBrowser);
  await fakeBrowser.storage.local.set({ enabled: false });
  await flush();

  const settings = await messageListener({ type: "getSettings" }, {});
  assert.equal(settings.enabled, false);
});

test("queueRuleWrite serializes concurrent setRule calls so both are persisted", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const listener = getOnMessageListener(fakeBrowser);
  const [r1, r2] = await Promise.all([
    listener({ type: "setRule", domain: "a.example", cookieStoreId: "container-a" }, {}),
    listener({ type: "setRule", domain: "b.example", cookieStoreId: "container-b" }, {}),
  ]);

  assert.deepEqual(r1, { ok: true });
  assert.deepEqual(r2, { ok: true });
  assert.deepEqual(fakeBrowser._storageData.rules, {
    "a.example": "container-a",
    "b.example": "container-b",
  });
});

test("setRule with an invalid domain returns ok:false without touching storage", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const listener = getOnMessageListener(fakeBrowser);
  const response = await listener({ type: "setRule", domain: "__proto__", cookieStoreId: "container-a" }, {});

  assert.deepEqual(response, { ok: false, error: "Invalid domain" });
  assert.deepEqual(fakeBrowser._storageData.rules, undefined);
});

test("deleteRule handler removes the domain from stored rules", async (t) => {
  const fakeBrowser = createFakeBrowser();
  fakeBrowser._storageData.rules = { "example.com": "container-a" };
  await loadBackground(t, fakeBrowser);

  const listener = getOnMessageListener(fakeBrowser);
  const response = await listener({ type: "deleteRule", domain: "example.com" }, {});

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(fakeBrowser._storageData.rules, {});
});

test("pick handler opens the chosen container and remembers the rule for the domain", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const pickerTabId = 20;
  fakeBrowser._results.tabsGet.set(pickerTabId, {
    id: pickerTabId,
    url: PICKER_URL_PREFIX,
    cookieStoreId: "firefox-default",
    windowId: 1,
    index: 0,
  });

  const listener = getOnMessageListener(fakeBrowser);
  const response = await listener(
    { type: "pick", url: "https://sub.example.com/path", cookieStoreId: "container-a", remember: true, rememberDomain: "example.com" },
    { tab: { id: pickerTabId } }
  );

  assert.deepEqual(response, { ok: true });
  assert.equal(fakeBrowser._calls.tabsCreate.length, 1);
  assert.equal(fakeBrowser._calls.tabsCreate[0].cookieStoreId, "container-a");
  assert.deepEqual(fakeBrowser._storageData.rules, { "example.com": "container-a" });
});

test("pick with a rememberDomain that is not a suffix of the hostname falls back to the exact hostname", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const pickerTabId = 21;
  fakeBrowser._results.tabsGet.set(pickerTabId, {
    id: pickerTabId,
    url: PICKER_URL_PREFIX,
    cookieStoreId: "firefox-default",
    windowId: 1,
    index: 0,
  });

  const listener = getOnMessageListener(fakeBrowser);
  const response = await listener(
    { type: "pick", url: "https://example.com/path", cookieStoreId: "container-a", remember: true, rememberDomain: "other.example" },
    { tab: { id: pickerTabId } }
  );

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(fakeBrowser._storageData.rules, { "example.com": "container-a" });
});

test("pick with an unparsable url returns ok:false", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const listener = getOnMessageListener(fakeBrowser);
  const response = await listener({ type: "pick", url: "not a url", cookieStoreId: "container-a" }, {});

  assert.deepEqual(response, { ok: false, error: "Invalid URL" });
});

test('pick with remember and rememberDomain "__proto__" returns ok:false without touching storage', async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const listener = getOnMessageListener(fakeBrowser);
  const response = await listener(
    { type: "pick", url: "https://example.com/", cookieStoreId: "container-a", remember: true, rememberDomain: "__proto__" },
    { tab: { id: 22 } }
  );

  assert.deepEqual(response, { ok: false, error: "Invalid domain" });
  assert.equal(fakeBrowser._calls.tabsCreate.length, 0);
  assert.deepEqual(fakeBrowser._storageData.rules, undefined);
});

test("cancel handler removes the sender tab", async (t) => {
  const fakeBrowser = createFakeBrowser();
  await loadBackground(t, fakeBrowser);

  const listener = getOnMessageListener(fakeBrowser);
  const response = await listener({ type: "cancel" }, { tab: { id: 30 } });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(fakeBrowser._calls.tabsRemove, [30]);
});

test("removing a container that still has rules referencing it logs a warning", async (t) => {
  const fakeBrowser = createFakeBrowser();
  fakeBrowser._storageData.rules = { "example.com": "container-a" };
  await loadBackground(t, fakeBrowser);

  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);
  t.after(() => {
    console.warn = originalWarn;
  });

  for (const listener of fakeBrowser.contextualIdentities.onRemoved.listeners) {
    listener({ contextualIdentity: { cookieStoreId: "container-a" } });
  }

  assert.equal(warnCalls.length, 1);
});

test("sanitizeSettings", async (t) => {
  const fakeBrowser = createFakeBrowser();
  const bg = await loadBackground(t, fakeBrowser);
  const { sanitizeSettings } = bg;

  await t.test("enabled: any non-false value is treated as enabled, including falsy 0", () => {
    assert.equal(sanitizeSettings({ enabled: 0, routeTypedUrls: false, rules: {} }).enabled, true);
  });

  await t.test('enabled: the string "false" is not the boolean false, so it is treated as enabled', () => {
    assert.equal(sanitizeSettings({ enabled: "false", routeTypedUrls: false, rules: {} }).enabled, true);
  });

  await t.test("enabled: boolean false disables", () => {
    assert.equal(sanitizeSettings({ enabled: false, routeTypedUrls: false, rules: {} }).enabled, false);
  });

  await t.test('routeTypedUrls: only the boolean true enables it, "yes" does not', () => {
    assert.equal(sanitizeSettings({ enabled: true, routeTypedUrls: "yes", rules: {} }).routeTypedUrls, false);
  });

  await t.test("rules: an array is not a valid rules map and is dropped to {}", () => {
    assert.deepEqual(sanitizeSettings({ enabled: true, routeTypedUrls: false, rules: ["a"] }).rules, {});
  });

  await t.test("rules: entries with a non-string value are dropped", () => {
    assert.deepEqual(
      sanitizeSettings({
        enabled: true,
        routeTypedUrls: false,
        rules: { "a.example": "container-a", "b.example": 123 },
      }).rules,
      { "a.example": "container-a" }
    );
  });
});
