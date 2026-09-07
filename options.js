// Options page: toggles global behaviour and manages the domain -> container
// rule table. Toggles write browser.storage.local directly; rule mutations go
// through the background page's setRule/deleteRule messages so writes are
// serialized with any concurrent picker "remember" writes.

const DEFAULT_COOKIE_STORE_ID = "firefox-default";

const DEFAULT_SETTINGS = {
  enabled: true,
  routeTypedUrls: false,
  rules: {},
};

let containers = [];
let containersLoadFailed = false;
// Domain of the rule <select> currently focused, so a re-render triggered by
// storage.onChanged can restore focus to the equivalent row.
let focusedRuleDomain = null;

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

function showFatalError(text) {
  const el = document.getElementById("fatal-error-text");
  el.textContent = text;
  el.hidden = false;
}

function setAddFormDisabled(disabled) {
  document.getElementById("new-domain-input").disabled = disabled;
  document.getElementById("new-container-select").disabled = disabled;
  document.getElementById("add-rule-button").disabled = disabled;
}

async function loadToggles() {
  const settings = await getSettings();
  document.getElementById("enabled-checkbox").checked = settings.enabled;
  document.getElementById("route-typed-checkbox").checked = settings.routeTypedUrls;
}

// Compares the rules table already rendered in the DOM against a freshly
// read rules map, so a re-render caused by our own write (the <select>
// already shows the new value) can be skipped.
function rulesMatchRenderedTable(newRules) {
  const tbody = document.getElementById("rules-tbody");
  const rows = Array.from(tbody.querySelectorAll("tr"));
  const newDomains = Object.keys(newRules);

  if (rows.length !== newDomains.length) {
    return false;
  }

  for (const row of rows) {
    const domain = row.querySelector("td").textContent;
    const select = row.querySelector("select");
    if (!Object.prototype.hasOwnProperty.call(newRules, domain) || select.value !== newRules[domain]) {
      return false;
    }
  }
  return true;
}

async function renderRulesTable() {
  const settings = await getSettings();
  const tbody = document.getElementById("rules-tbody");
  tbody.textContent = "";

  for (const [domain, cookieStoreId] of Object.entries(settings.rules)) {
    const row = document.createElement("tr");
    const isUnknown = cookieStoreId !== DEFAULT_COOKIE_STORE_ID && containerName(cookieStoreId) === null;
    if (isUnknown) {
      row.title = "This rule points to a container that no longer exists.";
    }

    const domainCell = document.createElement("td");
    domainCell.textContent = domain;
    row.appendChild(domainCell);

    const containerCell = document.createElement("td");
    const select = document.createElement("select");
    select.className = "select";
    select.setAttribute("aria-label", "Container for " + domain);
    select.dataset.domain = domain;
    select.appendChild(buildContainerOptions(cookieStoreId));
    select.value = cookieStoreId;
    select.addEventListener("focus", () => {
      focusedRuleDomain = domain;
    });
    select.addEventListener("blur", () => {
      if (focusedRuleDomain === domain) {
        focusedRuleDomain = null;
      }
    });
    select.addEventListener("change", async () => {
      const response = await browser.runtime.sendMessage({
        type: "setRule",
        domain,
        cookieStoreId: select.value,
      });
      if (!response || response.ok === false) {
        showFatalError((response && response.error) || "Could not save the rule.");
      }
    });
    containerCell.appendChild(select);
    row.appendChild(containerCell);

    const deleteCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn btn-ghost btn-danger";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", "Delete rule for " + domain);
    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Delete the rule for ${domain}?`)) {
        return;
      }
      const response = await browser.runtime.sendMessage({ type: "deleteRule", domain });
      if (!response || response.ok === false) {
        showFatalError((response && response.error) || "Could not delete the rule.");
      }
    });
    deleteCell.appendChild(deleteButton);
    row.appendChild(deleteCell);

    tbody.appendChild(row);
  }
}

function renderNewContainerSelect() {
  const select = document.getElementById("new-container-select");
  select.textContent = "";
  select.appendChild(buildContainerOptions(null));
}

async function handleAddRuleSubmit(event) {
  event.preventDefault();

  const domainInput = document.getElementById("new-domain-input");
  const containerSelect = document.getElementById("new-container-select");
  const errorEl = document.getElementById("add-rule-error-text");

  errorEl.hidden = true;
  domainInput.removeAttribute("aria-invalid");

  const domain = normalizeDomain(domainInput.value);
  const isSingleLabel = domain !== null && domain.indexOf(".") === -1;
  if (!domain || (isSingleLabel && domain !== "localhost")) {
    domainInput.setAttribute("aria-invalid", "true");
    errorEl.textContent = "Enter a valid domain, e.g. example.com.";
    errorEl.hidden = false;
    return;
  }

  const settings = await getSettings();
  if (Object.prototype.hasOwnProperty.call(settings.rules, domain)) {
    const replace = confirm(`A rule for ${domain} already exists. Replace it?`);
    if (!replace) {
      return;
    }
  }

  const response = await browser.runtime.sendMessage({
    type: "setRule",
    domain,
    cookieStoreId: containerSelect.value,
  });
  if (!response || response.ok === false) {
    errorEl.textContent = (response && response.error) || "Could not save the rule.";
    errorEl.hidden = false;
    return;
  }

  domainInput.value = "";
}

function handleStorageChanged(changes, areaName) {
  if (areaName !== "local") {
    return;
  }
  if (changes.enabled) {
    document.getElementById("enabled-checkbox").checked = changes.enabled.newValue;
  }
  if (changes.routeTypedUrls) {
    document.getElementById("route-typed-checkbox").checked = changes.routeTypedUrls.newValue;
  }
  if (changes.rules) {
    const newRules =
      changes.rules.newValue && typeof changes.rules.newValue === "object" ? changes.rules.newValue : {};
    if (!rulesMatchRenderedTable(newRules)) {
      const domainToRestore = focusedRuleDomain;
      renderRulesTable().then(() => {
        if (domainToRestore) {
          const select = document.querySelector(
            'select[data-domain="' + CSS.escape(domainToRestore) + '"]'
          );
          if (select) {
            select.focus();
          }
        }
      });
    }
  }
}

function attachEventListeners() {
  document.getElementById("enabled-checkbox").addEventListener("change", async (event) => {
    await browser.storage.local.set({ enabled: event.target.checked });
  });

  document.getElementById("route-typed-checkbox").addEventListener("change", async (event) => {
    await browser.storage.local.set({ routeTypedUrls: event.target.checked });
  });

  document.getElementById("add-rule-form").addEventListener("submit", handleAddRuleSubmit);

  browser.storage.onChanged.addListener(handleStorageChanged);
}

async function init() {
  attachEventListeners();

  try {
    try {
      containers = await browser.contextualIdentities.query({});
    } catch (err) {
      containersLoadFailed = true;
      showFatalError("Could not load containers: " + errMessage(err));
      setAddFormDisabled(true);
    }

    await loadToggles();
    if (!containersLoadFailed) {
      renderNewContainerSelect();
    }
    await renderRulesTable();
  } catch (err) {
    showFatalError("Failed to initialize the options page: " + errMessage(err));
  }
}

init();
