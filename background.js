// Background page: intercepts incoming external URLs and routes them to the
// container tied to the target Zen workspace, or shows a picker when no rule
// matches.

const LOG_PREFIX = "[zen-space-router]";

const DEFAULT_SETTINGS = {
  enabled: true,
  routeTypedUrls: false,
  rules: {},
};

const FRESH_TAB_MAX_AGE_MS = 10000;

// tabId -> { createdAt, active }, for tabs seen arriving as about:blank/empty.
const freshTabs = new Map();
// tabIds created by this extension itself, never intercepted.
const ownTabs = new Set();
// url -> array of registration timestamps (ms), for URLs this extension is
// about to open itself via tabs.create. Entries expire after
// OWN_PENDING_URL_TTL_MS so a leaked entry cannot swallow a later external open.
const ownPendingUrls = new Map();
const OWN_PENDING_URL_TTL_MS = 5000;

// Records that url is about to be opened by this extension.
function registerOwnPendingUrl(url) {
  const list = ownPendingUrls.get(url) || [];
  list.push(Date.now());
  ownPendingUrls.set(url, list);
}

// Consumes one non-expired registration for url. Returns true when one was
// found, false otherwise. Expired registrations are discarded.
function consumeOwnPendingUrl(url) {
  const list = ownPendingUrls.get(url);
  if (!list) {
    return false;
  }
  const now = Date.now();
  const live = list.filter((ts) => now - ts <= OWN_PENDING_URL_TTL_MS);
  const found = live.length > 0;
  if (found) {
    live.shift();
  }
  if (live.length > 0) {
    ownPendingUrls.set(url, live);
  } else {
    ownPendingUrls.delete(url);
  }
  return found;
}

// In-memory cache of sanitized settings, kept in sync with storage via
// browser.storage.onChanged so onBeforeRequest never has to await storage.
let settings = { ...DEFAULT_SETTINGS, rules: {} };

// Chain of pending rule writes, so concurrent setRule/deleteRule calls never
// race each other on a read-modify-write of the whole rules object.
let writeQueue = Promise.resolve();

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}

function logError(...args) {
  console.error(LOG_PREFIX, ...args);
}

function skipLog(reason, details) {
  console.debug(LOG_PREFIX + " skip", reason, details);
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

function sanitizeRules(rawRules) {
  const rules = {};
  if (rawRules && typeof rawRules === "object" && !Array.isArray(rawRules)) {
    for (const [key, value] of Object.entries(rawRules)) {
      if (typeof key === "string" && typeof value === "string") {
        rules[key] = value;
      }
    }
  }
  return rules;
}

function sanitizeSettings(stored) {
  return {
    enabled: stored.enabled !== false,
    routeTypedUrls: stored.routeTypedUrls === true,
    rules: sanitizeRules(stored.rules),
  };
}

async function loadSettings() {
  const stored = await browser.storage.local.get(DEFAULT_SETTINGS);
  settings = sanitizeSettings(stored);
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (changes.enabled || changes.routeTypedUrls || changes.rules) {
    loadSettings();
  }
});

loadSettings();

// Matches a hostname against the rules map: exact match first, then
// progressively strips leading labels ("a.b.example.com" -> "b.example.com"
// -> "example.com"), never falling back to a bare single-label candidate
// (e.g. "com") unless the hostname itself is single-label ("localhost"),
// which is then looked up exactly. Rules are stored and matched lowercased.
function findRule(hostname, rules) {
  let normalized = hostname.toLowerCase();
  while (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }
  if (normalized.length === 0) {
    return null;
  }

  const labels = normalized.split(".");
  if (labels.length === 1) {
    return Object.prototype.hasOwnProperty.call(rules, normalized) ? rules[normalized] : null;
  }

  let candidate = normalized;
  while (candidate.split(".").length >= 2) {
    if (Object.prototype.hasOwnProperty.call(rules, candidate)) {
      return rules[candidate];
    }
    const dotIndex = candidate.indexOf(".");
    candidate = candidate.slice(dotIndex + 1);
  }
  return null;
}

// Second-level suffixes (e.g. "co" in "co.uk") that get an extra label
// folded into the base domain. Not the public suffix list — just enough to
// cover common cases; unusual TLD structures may need manual editing on the
// options page.
const SECOND_LEVEL_SUFFIXES = ["co", "com", "org", "net", "gov", "edu", "ac", "gob", "or", "ne"];

// Derives the registrable base domain from a hostname: "www.facebook.com"
// -> "facebook.com", "a.b.example.co.uk" -> "example.co.uk". IPv4/IPv6
// literals and hostnames with two or fewer labels are returned unchanged.
function baseDomain(hostname) {
  if (typeof hostname !== "string" || hostname.length === 0) {
    return hostname;
  }
  if (hostname.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return hostname;
  }

  const labels = hostname.split(".");
  if (labels.length <= 2) {
    return hostname;
  }

  const tld = labels[labels.length - 1];
  const secondLevel = labels[labels.length - 2];
  if (tld.length === 2 && SECOND_LEVEL_SUFFIXES.includes(secondLevel) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

// Normalizes a user- or URL-supplied domain string into a bare hostname:
// trims, lowercases, strips a leading scheme, then relies on the URL parser
// to drop path/port, and strips leading/trailing dots. Returns null if the
// input can't be parsed into a hostname with at least one letter or digit.
function normalizeDomain(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  let cleaned = raw.trim().toLowerCase();
  if (!cleaned) {
    return null;
  }
  cleaned = cleaned.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  cleaned = cleaned.replace(/^\.+|\.+$/g, "");
  if (!cleaned) {
    return null;
  }
  try {
    const hostname = new URL("http://" + cleaned).hostname;
    if (!hostname || !/[a-z0-9]/i.test(hostname)) {
      return null;
    }
    return hostname;
  } catch (err) {
    return null;
  }
}

// Queues a read-modify-write of the rules map so setRule/deleteRule calls
// never clobber each other, then persists the result to storage.
function queueRuleWrite(mutator) {
  writeQueue = writeQueue.then(async () => {
    const stored = await browser.storage.local.get({ rules: {} });
    const rules = sanitizeRules(stored.rules);
    mutator(rules);
    await browser.storage.local.set({ rules });
  });
  return writeQueue;
}

// Opens url in the given container and closes sourceTab on success. Rejects
// without touching sourceTab if the container is unavailable, so callers can
// fall back (e.g. to the picker) instead of silently using the default
// container.
async function openInContainer(url, cookieStoreId, sourceTab) {
  registerOwnPendingUrl(url);

  let newTab;
  try {
    newTab = await browser.tabs.create({
      url,
      cookieStoreId,
      active: true,
      windowId: sourceTab.windowId,
      index: sourceTab.index + 1,
    });
  } catch (err) {
    consumeOwnPendingUrl(url);
    logError("tabs.create with cookieStoreId failed", {
      cookieStoreId,
      message: errorMessage(err),
    });
    throw new Error(`Container ${cookieStoreId} is unavailable: ${errorMessage(err)}`);
  }

  ownTabs.add(newTab.id);

  try {
    await browser.tabs.remove(sourceTab.id);
  } catch (err) {
    logError("tabs.remove failed", { tabId: sourceTab.id, message: errorMessage(err) });
  }
}

// Navigates the source tab to the picker in place of the intercepted URL.
async function navigateToPicker(tab, url) {
  const pickerUrl =
    browser.runtime.getURL("picker.html") +
    "?url=" +
    encodeURIComponent(url) +
    "&cookieStoreId=" +
    encodeURIComponent(tab.cookieStoreId || "");

  try {
    await browser.tabs.update(tab.id, { url: pickerUrl, active: true });
  } catch (err) {
    logError("tabs.update to picker failed", { tabId: tab.id, message: errorMessage(err) });
    return {};
  }
  return { cancel: true };
}

browser.tabs.onCreated.addListener((tab) => {
  const isEmpty = !tab.url || tab.url === "about:blank";
  if (isEmpty) {
    freshTabs.set(tab.id, { createdAt: Date.now(), active: tab.active === true });
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  freshTabs.delete(tabId);
  ownTabs.delete(tabId);
});

// Async part of onBeforeRequest: only reached once all synchronous guards in
// onBeforeRequestListener have passed.
async function handleFreshCandidate(details, url) {
  const freshInfo = freshTabs.get(details.tabId);
  if (!freshInfo || Date.now() - freshInfo.createdAt > FRESH_TAB_MAX_AGE_MS) {
    freshTabs.delete(details.tabId);
    skipLog("stale-fresh-tab", { tabId: details.tabId, url: details.url });
    return {};
  }

  let tab;
  try {
    tab = await browser.tabs.get(details.tabId);
  } catch (err) {
    freshTabs.delete(details.tabId);
    logError("tabs.get failed", { tabId: details.tabId, message: errorMessage(err) });
    return {};
  }

  const isTabFresh = (tab.url === "about:blank" || !tab.url) && !tab.openerTabId;
  if (!isTabFresh) {
    freshTabs.delete(details.tabId);
    skipLog("tab-not-fresh", { tabId: details.tabId, url: details.url });
    return {};
  }

  if (freshInfo.active && !settings.routeTypedUrls) {
    // Typed into a fresh active tab, not an external link.
    freshTabs.delete(details.tabId);
    skipLog("typed-url", { tabId: details.tabId, url: details.url });
    return {};
  }

  freshTabs.delete(details.tabId);

  const hostname = url.hostname;
  const rule = findRule(hostname, settings.rules);

  if (rule) {
    if (rule === tab.cookieStoreId) {
      skipLog("already-in-target-container", { tabId: details.tabId, url: details.url });
      return {};
    }

    console.info(LOG_PREFIX, "routing", { hostname, url: details.url, cookieStoreId: rule });
    try {
      await openInContainer(details.url, rule, tab);
    } catch (err) {
      logError("openInContainer failed, falling back to picker", { message: errorMessage(err) });
      return navigateToPicker(tab, details.url);
    }
    return { cancel: true };
  }

  return navigateToPicker(tab, details.url);
}

function onBeforeRequestListener(details) {
  if (consumeOwnPendingUrl(details.url)) {
    // This is our own tabs.create navigation firing onBeforeRequest.
    skipLog("own-pending-url", { tabId: details.tabId, url: details.url, originUrl: details.originUrl });
    return {};
  }

  let url;
  try {
    url = new URL(details.url);
  } catch (err) {
    return {};
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {};
  }

  if (!settings.enabled) {
    return {};
  }

  if (details.tabId < 0 || ownTabs.has(details.tabId)) {
    return {};
  }

  if (details.originUrl || details.documentUrl) {
    // Page-initiated navigation (window.open, link click), not external.
    return {};
  }

  if (!freshTabs.has(details.tabId)) {
    return {};
  }

  return handleFreshCandidate(details, url).catch((err) => {
    logError("onBeforeRequest async handling failed", { message: errorMessage(err) });
    return {};
  });
}

browser.webRequest.onBeforeRequest.addListener(
  onBeforeRequestListener,
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"]
);

browser.contextualIdentities.onRemoved.addListener(({ contextualIdentity }) => {
  const cookieStoreId = contextualIdentity.cookieStoreId;
  const affected = Object.entries(settings.rules)
    .filter(([, ruleCookieStoreId]) => ruleCookieStoreId === cookieStoreId)
    .map(([domain]) => domain);

  if (affected.length > 0) {
    console.warn(LOG_PREFIX, "container removed but rules still reference it", {
      cookieStoreId,
      domains: affected,
    });
  }
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.type !== "string") {
    return;
  }

  switch (message.type) {
    case "getContainers":
      return browser.contextualIdentities.query({}).then((identities) =>
        identities.map((identity) => ({
          name: identity.name,
          cookieStoreId: identity.cookieStoreId,
          color: identity.color,
          icon: identity.icon,
        }))
      );

    case "pick":
      return (async () => {
        let url;
        try {
          url = new URL(message.url);
        } catch (err) {
          return { ok: false, error: "Invalid URL" };
        }

        if (message.remember) {
          const hostname = url.hostname;
          const requestedDomain = normalizeDomain(message.rememberDomain);
          const isValidDomain =
            requestedDomain !== null &&
            (requestedDomain === hostname || hostname.endsWith("." + requestedDomain));
          const domain = isValidDomain ? requestedDomain : hostname;
          await queueRuleWrite((rules) => {
            rules[domain] = message.cookieStoreId;
          });
        }

        const pickerTabId = sender.tab && sender.tab.id;
        if (typeof pickerTabId !== "number") {
          return { ok: false, error: "Unknown picker tab" };
        }

        let tab;
        try {
          tab = await browser.tabs.get(pickerTabId);
        } catch (err) {
          return { ok: false, error: errorMessage(err) };
        }

        try {
          await openInContainer(url.toString(), message.cookieStoreId, tab);
        } catch (err) {
          return { ok: false, error: errorMessage(err) };
        }
        return { ok: true };
      })();

    case "cancel":
      return (async () => {
        const pickerTabId = sender.tab && sender.tab.id;
        if (typeof pickerTabId !== "number") {
          return { ok: false, error: "Unknown picker tab" };
        }
        try {
          await browser.tabs.remove(pickerTabId);
        } catch (err) {
          return { ok: false, error: errorMessage(err) };
        }
        return { ok: true };
      })();

    case "getSettings":
      return Promise.resolve(settings);

    case "setRule":
      return queueRuleWrite((rules) => {
        rules[message.domain] = message.cookieStoreId;
      })
        .then(() => ({ ok: true }))
        .catch((err) => ({ ok: false, error: errorMessage(err) }));

    case "deleteRule":
      return queueRuleWrite((rules) => {
        delete rules[message.domain];
      })
        .then(() => ({ ok: true }))
        .catch((err) => ({ ok: false, error: errorMessage(err) }));

    default:
      return undefined;
  }
});
