// Prints a timestamped log line. Timestamps are relative (performance.now)
// so a human can measure latency between related events (e.g. onCreated vs
// onBeforeNavigate / onBeforeRequest).
function log(label, obj) {
  console.log("[probe " + (performance.now() | 0) + "ms] " + label, JSON.stringify(obj));
}

// Logs every contextual identity (container) available at startup, plus the
// extension's own moz-extension origin, useful to spot it in navigation logs.
(async function logStartupInfo() {
  try {
    const identities = await browser.contextualIdentities.query({});
    for (const identity of identities) {
      log("contextualIdentity", {
        name: identity.name,
        cookieStoreId: identity.cookieStoreId,
        color: identity.color,
      });
    }
  } catch (err) {
    log("contextualIdentities.query error", { message: String(err) });
  }

  try {
    log("extension origin", { url: browser.runtime.getURL("") });
  } catch (err) {
    log("runtime.getURL error", { message: String(err) });
  }
})();

browser.tabs.onCreated.addListener((tab) => {
  try {
    if (tab.url && tab.url.startsWith("moz-extension://")) {
      return;
    }
    log("tabs.onCreated", {
      id: tab.id,
      openerTabId: tab.openerTabId,
      url: tab.url,
      pendingUrl: tab.pendingUrl,
      cookieStoreId: tab.cookieStoreId,
      windowId: tab.windowId,
      active: tab.active,
      status: tab.status,
      title: tab.title,
    });
  } catch (err) {
    log("tabs.onCreated error", { message: String(err) });
  }
});

browser.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    try {
      log("tabs.onUpdated", {
        tabId,
        changeInfo,
        cookieStoreId: tab.cookieStoreId,
        openerTabId: tab.openerTabId,
        url: tab.url,
      });
    } catch (err) {
      log("tabs.onUpdated error", { message: String(err) });
    }
  },
  { properties: ["url", "status"] }
);

browser.webNavigation.onBeforeNavigate.addListener((details) => {
  try {
    if (details.frameId !== 0) {
      return;
    }
    log("webNavigation.onBeforeNavigate", {
      tabId: details.tabId,
      url: details.url,
      frameId: details.frameId,
      parentFrameId: details.parentFrameId,
      timeStamp: details.timeStamp,
    });
  } catch (err) {
    log("webNavigation.onBeforeNavigate error", { message: String(err) });
  }
});

browser.webNavigation.onCommitted.addListener((details) => {
  try {
    if (details.frameId !== 0) {
      return;
    }
    log("webNavigation.onCommitted", {
      tabId: details.tabId,
      url: details.url,
      frameId: details.frameId,
      transitionType: details.transitionType,
      transitionQualifiers: details.transitionQualifiers,
    });
  } catch (err) {
    log("webNavigation.onCommitted error", { message: String(err) });
  }
});

browser.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  try {
    log("webNavigation.onCreatedNavigationTarget", {
      sourceTabId: details.sourceTabId,
      tabId: details.tabId,
      url: details.url,
    });
  } catch (err) {
    log("webNavigation.onCreatedNavigationTarget error", { message: String(err) });
  }
});

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      log("webRequest.onBeforeRequest", {
        requestId: details.requestId,
        tabId: details.tabId,
        url: details.url,
        cookieStoreId: details.cookieStoreId,
        originUrl: details.originUrl,
        documentUrl: details.documentUrl,
        timeStamp: details.timeStamp,
      });

      browser.tabs
        .get(details.tabId)
        .then((tab) => {
          log("webRequest.onBeforeRequest tabs.get", {
            tabId: details.tabId,
            openerTabId: tab.openerTabId,
            cookieStoreId: tab.cookieStoreId,
            url: tab.url,
          });
        })
        .catch((err) => {
          log("webRequest.onBeforeRequest tabs.get error", { message: String(err) });
        });
    } catch (err) {
      log("webRequest.onBeforeRequest error", { message: String(err) });
    }
    return {};
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"]
);

browser.tabs.onRemoved.addListener((tabId) => {
  try {
    log("tabs.onRemoved", { tabId });
  } catch (err) {
    log("tabs.onRemoved error", { message: String(err) });
  }
});
