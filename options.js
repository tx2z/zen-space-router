// Options page ("Space Router Settings"): manages the global toggles and the
// domain -> container rule list, styled after Zen's native Space Routing
// dialog. Rule mutations go through the background page's setRule/deleteRule
// messages so writes are serialized with any concurrent picker "remember"
// writes.

const DEFAULT_COOKIE_STORE_ID = "firefox-default";
const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_SETTINGS = {
  enabled: true,
  routeTypedUrls: false,
  rules: {},
};

let containers = [];
let containersLoadFailed = false;

// True while an input/select/button inside the rule list has focus, so a
// re-render triggered by storage.onChanged never interrupts typing.
let listFocused = false;
// True when a rules change arrived while the list was focused; applied on
// the next blur out of the list.
let pendingRulesRerender = false;

// Normalizes a user- or URL-supplied domain string into a bare hostname.
// Kept in sync with the copy in background.js (no shared modules in MV2).
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

function errMessage(err) {
  return err && err.message ? err.message : String(err);
}

async function getSettings() {
  const stored = await browser.storage.local.get(DEFAULT_SETTINGS);
  return {
    enabled: stored.enabled,
    routeTypedUrls: stored.routeTypedUrls,
    rules: stored.rules && typeof stored.rules === "object" ? stored.rules : {},
  };
}

function containerName(cookieStoreId) {
  if (cookieStoreId === DEFAULT_COOKIE_STORE_ID) {
    return "No container (default)";
  }
  const found = containers.find((c) => c.cookieStoreId === cookieStoreId);
  return found ? found.name : null;
}

function buildContainerOptions(selectedCookieStoreId) {
  const fragment = document.createDocumentFragment();

  const defaultOption = document.createElement("option");
  defaultOption.value = DEFAULT_COOKIE_STORE_ID;
  defaultOption.textContent = "No container (default)";
  fragment.appendChild(defaultOption);

  for (const container of containers) {
    const option = document.createElement("option");
    option.value = container.cookieStoreId;
    option.textContent = container.name;
    fragment.appendChild(option);
  }

  if (selectedCookieStoreId && containerName(selectedCookieStoreId) === null) {
    // Points at a container that no longer exists: keep it selectable so the
    // rule stays visible and editable rather than silently losing its value.
    const unknownOption = document.createElement("option");
    unknownOption.value = selectedCookieStoreId;
    unknownOption.textContent = selectedCookieStoreId + " (missing container)";
    fragment.appendChild(unknownOption);
  }

  return fragment;
}

function buildRemoveIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  for (const [x1, y1, x2, y2] of [
    ["1", "1", "13", "13"],
    ["13", "1", "1", "13"],
  ]) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-linecap", "round");
    svg.appendChild(line);
  }

  return svg;
}

function showFatalError(text) {
  const el = document.getElementById("fatal-error-text");
  el.textContent = text;
  el.hidden = false;
}

function setControlsDisabled(disabled) {
  document.getElementById("new-rule-button").disabled = disabled;
  document.querySelectorAll("#rules-list select").forEach((select) => {
    select.disabled = disabled;
  });
}

function updateEmptyState() {
  const rulesListEl = document.getElementById("rules-list");
  document.getElementById("empty-state").hidden = rulesListEl.children.length > 0;
}

// Builds one editable rule row. domain is "" for a not-yet-saved new row.
function createRuleRow(domain, cookieStoreId) {
  const row = document.createElement("div");
  row.className = "sr-rule-row";
  row.dataset.committedDomain = domain || "";
  if (domain && cookieStoreId !== DEFAULT_COOKIE_STORE_ID && containerName(cookieStoreId) === null) {
    row.title = "This rule points to a container that no longer exists.";
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "input";
  input.value = domain || "";
  input.placeholder = "example.com";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.setAttribute("inputmode", "url");
  input.setAttribute("aria-label", "Domain");

  const select = document.createElement("select");
  select.className = "select";
  select.setAttribute("aria-label", domain ? "Container for " + domain : "Container for new rule");
  select.appendChild(buildContainerOptions(cookieStoreId));
  select.value = cookieStoreId;
  select.disabled = containersLoadFailed;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "sr-remove-button";
  removeButton.setAttribute("aria-label", domain ? "Remove rule for " + domain : "Remove new rule");
  removeButton.appendChild(buildRemoveIcon());

  // Commits the input on Enter or blur: normalizes the domain, then swaps
  // the old rule for the new one (or discards an empty unsaved row).
  async function commitDomain() {
    input.classList.remove("invalid");
    const raw = input.value;
    const committed = row.dataset.committedDomain;

    if (!raw.trim()) {
      if (!committed) {
        row.remove();
        updateEmptyState();
      }
      return;
    }

    const normalized = normalizeDomain(raw);
    const isSingleLabel = normalized !== null && normalized.indexOf(".") === -1;
    if (!normalized || (isSingleLabel && normalized !== "localhost")) {
      input.classList.add("invalid");
      return;
    }

    input.value = normalized;
    if (normalized === committed) {
      return;
    }

    if (committed) {
      const deleteResponse = await browser.runtime.sendMessage({ type: "deleteRule", domain: committed });
      if (!deleteResponse || deleteResponse.ok === false) {
        showFatalError((deleteResponse && deleteResponse.error) || "Could not save the rule.");
        return;
      }
    }
    const setResponse = await browser.runtime.sendMessage({
      type: "setRule",
      domain: normalized,
      cookieStoreId: select.value,
    });
    if (!setResponse || setResponse.ok === false) {
      showFatalError((setResponse && setResponse.error) || "Could not save the rule.");
      return;
    }

    row.dataset.committedDomain = normalized;
    row.title = "";
    select.setAttribute("aria-label", "Container for " + normalized);
    removeButton.setAttribute("aria-label", "Remove rule for " + normalized);
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  input.addEventListener("blur", commitDomain);

  select.addEventListener("change", async () => {
    const committed = row.dataset.committedDomain;
    if (!committed) {
      return;
    }
    const response = await browser.runtime.sendMessage({
      type: "setRule",
      domain: committed,
      cookieStoreId: select.value,
    });
    if (!response || response.ok === false) {
      showFatalError((response && response.error) || "Could not save the rule.");
    }
  });

  removeButton.addEventListener("click", async () => {
    const committed = row.dataset.committedDomain;
    if (!committed) {
      row.remove();
      updateEmptyState();
      return;
    }
    if (!confirm(`Delete the rule for ${committed}?`)) {
      return;
    }
    const response = await browser.runtime.sendMessage({ type: "deleteRule", domain: committed });
    if (!response || response.ok === false) {
      showFatalError((response && response.error) || "Could not delete the rule.");
    }
  });

  row.appendChild(input);
  row.appendChild(select);
  row.appendChild(removeButton);
  return row;
}

function captureListFocus() {
  const active = document.activeElement;
  const row = active && active.closest ? active.closest(".sr-rule-row") : null;
  if (!row) {
    return null;
  }
  return {
    domain: row.dataset.committedDomain,
    field: active.tagName === "SELECT" ? "select" : "input",
  };
}

function restoreListFocus(focusInfo) {
  if (!focusInfo || !focusInfo.domain) {
    return;
  }
  for (const row of document.querySelectorAll(".sr-rule-row")) {
    if (row.dataset.committedDomain === focusInfo.domain) {
      const el = focusInfo.field === "select" ? row.querySelector("select") : row.querySelector(".input");
      if (el) {
        el.focus();
      }
      break;
    }
  }
}

async function renderRulesList(preserveFocus) {
  const settings = await getSettings();
  const rulesListEl = document.getElementById("rules-list");

  const focusInfo = preserveFocus ? captureListFocus() : null;

  rulesListEl.textContent = "";
  for (const [domain, cookieStoreId] of Object.entries(settings.rules)) {
    rulesListEl.appendChild(createRuleRow(domain, cookieStoreId));
  }

  updateEmptyState();
  restoreListFocus(focusInfo);
}

async function loadFooter() {
  const settings = await getSettings();
  document.getElementById("unmatched-select").value = settings.enabled ? "ask" : "leave";
  document.getElementById("route-typed-checkbox").checked = settings.routeTypedUrls;
}

function handleStorageChanged(changes, areaName) {
  if (areaName !== "local") {
    return;
  }
  if (changes.enabled) {
    document.getElementById("unmatched-select").value = changes.enabled.newValue ? "ask" : "leave";
  }
  if (changes.routeTypedUrls) {
    document.getElementById("route-typed-checkbox").checked = changes.routeTypedUrls.newValue;
  }
  if (changes.rules) {
    if (listFocused) {
      pendingRulesRerender = true;
      return;
    }
    renderRulesList(true);
  }
}

function attachEventListeners() {
  document.getElementById("new-rule-button").addEventListener("click", () => {
    if (containersLoadFailed) {
      return;
    }
    const defaultCookieStoreId = containers.length > 0 ? containers[0].cookieStoreId : DEFAULT_COOKIE_STORE_ID;
    const row = createRuleRow("", defaultCookieStoreId);
    document.getElementById("rules-list").appendChild(row);
    updateEmptyState();
    row.querySelector(".input").focus();
  });

  document.getElementById("unmatched-select").addEventListener("change", async (event) => {
    await browser.storage.local.set({ enabled: event.target.value === "ask" });
  });

  document.getElementById("route-typed-checkbox").addEventListener("change", async (event) => {
    await browser.storage.local.set({ routeTypedUrls: event.target.checked });
  });

  const rulesListEl = document.getElementById("rules-list");
  rulesListEl.addEventListener("focusin", () => {
    listFocused = true;
  });
  rulesListEl.addEventListener("focusout", () => {
    // Deferred so a focus move between two controls in the same row (e.g.
    // input -> select) is not mistaken for leaving the list.
    setTimeout(() => {
      if (rulesListEl.contains(document.activeElement)) {
        return;
      }
      listFocused = false;
      if (pendingRulesRerender) {
        pendingRulesRerender = false;
        renderRulesList(true);
      }
    }, 0);
  });

  browser.storage.onChanged.addListener(handleStorageChanged);
}

async function init() {
  attachEventListeners();

  try {
    try {
      containers = await browser.contextualIdentities.query({});
    } catch (err) {
      containersLoadFailed = true;
      showFatalError("Container list could not be loaded: " + errMessage(err));
    }

    await loadFooter();
    await renderRulesList(false);

    if (containersLoadFailed) {
      setControlsDisabled(true);
    }
  } catch (err) {
    showFatalError("Failed to initialize the options page: " + errMessage(err));
  }
}

init();
