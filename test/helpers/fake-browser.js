"use strict";

// Minimal fake of the WebExtension `browser` global, covering only the
// APIs background.js touches. Listener registrations are captured so tests
// can drive them directly; tabs.* calls are recorded and return
// configurable results via the `results` maps on the returned object.

function makeEvent() {
  const listeners = [];
  const registrations = [];
  return {
    addListener(fn, filter, extraInfoSpec) {
      listeners.push(fn);
      registrations.push({ filter, extraInfoSpec });
    },
    listeners,
    registrations,
  };
}

function createFakeBrowser() {
  const calls = {
    tabsCreate: [],
    tabsUpdate: [],
    tabsRemove: [],
    tabsGetMisses: 0,
  };

  // Test-configurable results: push a function onto these arrays to control
  // the outcome of successive calls (resolve value or thrown error), one
  // entry consumed (shifted) per call. Once the queue for a given call is
  // empty, the call falls through to the default behaviour below.
  const results = {
    tabsGet: new Map(), // tabId -> tab object or Error
    tabsCreate: [], // array of (details) => tab object or throws
    tabsUpdate: [], // array of (tabId, details) => throws or resolves
    tabsRemove: [], // array of (tabId) => throws or resolves
  };

  const storageData = {};

  const fakeBrowser = {
    _calls: calls,
    _results: results,
    _storageData: storageData,

    tabs: {
      onCreated: makeEvent(),
      onRemoved: makeEvent(),
      async get(tabId) {
        const entry = results.tabsGet.get(tabId);
        if (entry instanceof Error) {
          throw entry;
        }
        if (entry === undefined) {
          calls.tabsGetMisses += 1;
          throw new Error(`No fake tab registered for tabId ${tabId}`);
        }
        return entry;
      },
      async create(details) {
        calls.tabsCreate.push(details);
        const newTab = { id: 1000 + calls.tabsCreate.length, ...details };
        for (const listener of fakeBrowser.tabs.onCreated.listeners) {
          listener({ id: newTab.id, url: "about:blank", active: details.active === true });
        }
        const handler = results.tabsCreate.shift();
        if (handler) {
          return handler(details);
        }
        return newTab;
      },
      async update(tabId, details) {
        calls.tabsUpdate.push({ tabId, details });
        const handler = results.tabsUpdate.shift();
        if (handler) {
          return handler(tabId, details);
        }
        return { id: tabId, ...details };
      },
      async remove(tabId) {
        calls.tabsRemove.push(tabId);
        const handler = results.tabsRemove.shift();
        if (handler) {
          return handler(tabId);
        }
        return undefined;
      },
    },

    webRequest: {
      onBeforeRequest: makeEvent(),
    },

    storage: {
      local: {
        async get(defaultsOrKeys) {
          if (defaultsOrKeys && typeof defaultsOrKeys === "object" && !Array.isArray(defaultsOrKeys)) {
            const out = {};
            for (const key of Object.keys(defaultsOrKeys)) {
              out[key] = Object.prototype.hasOwnProperty.call(storageData, key)
                ? storageData[key]
                : defaultsOrKeys[key];
            }
            return out;
          }
          return { ...storageData };
        },
        async set(values) {
          const changes = {};
          for (const [key, newValue] of Object.entries(values)) {
            const oldValue = storageData[key];
            changes[key] = { oldValue, newValue };
          }
          Object.assign(storageData, values);
          for (const listener of fakeBrowser.storage.onChanged.listeners) {
            listener(changes, "local");
          }
        },
      },
      onChanged: makeEvent(),
    },

    runtime: {
      onMessage: makeEvent(),
      getURL(path) {
        return "moz-extension://fake-id/" + path;
      },
    },

    contextualIdentities: {
      onRemoved: makeEvent(),
      onCreated: makeEvent(),
      onUpdated: makeEvent(),
      async query() {
        return [];
      },
    },
  };

  return fakeBrowser;
}

module.exports = { createFakeBrowser };
