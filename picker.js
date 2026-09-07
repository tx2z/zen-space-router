// Lets the user pick which container (Zen workspace proxy) an intercepted
// URL should open in.

const CONTAINER_COLORS = {
  blue: "#37adff",
  turquoise: "#00c79a",
  green: "#51cd00",
  yellow: "#ffcb00",
  orange: "#ff9f00",
  red: "#ff613d",
  pink: "#ff4bda",
  purple: "#af51f5",
  toolbar: "#7c7c7d",
};

const DEFAULT_COOKIE_STORE_ID = "firefox-default";
const MAX_KEYED_CONTAINERS = 9;

// Bidi control characters (embeddings/overrides and isolates) that could be
// used to make a URL render misleadingly; stripped before display.
const BIDI_CONTROL_CHARS_RE = /[\u202A-\u202E\u2066-\u2069]/g;

function stripBidiControls(text) {
  return text.replace(BIDI_CONTROL_CHARS_RE, "");
}

// Second-level suffixes (e.g. "co" in "co.uk") that get an extra label
// folded into the base domain. Not the public suffix list — just enough to
// cover common cases; unusual TLD structures may need manual editing on the
// options page. Kept in sync with the copy in background.js.
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

const params = new URLSearchParams(location.search);
const rawUrl = params.get("url") || "";
const currentCookieStoreId = params.get("cookieStoreId") || "";

let targetUrl = null;
try {
  targetUrl = new URL(rawUrl);
} catch (err) {
  targetUrl = null;
}

let picked = false;
let canceled = false;
// key -> cookieStoreId, populated once containers are rendered.
const keyMap = new Map();

const errorTextEl = document.getElementById("error-text");
const urlBlockEl = document.getElementById("url-block");
const rememberRowEl = document.getElementById("remember-row");
const subdomainsRowEl = document.getElementById("subdomains-row");
const rowListEl = document.getElementById("row-list");
const footerTextEl = document.getElementById("footer-text");

function showError(text) {
  errorTextEl.textContent = text;
  errorTextEl.hidden = false;
}

function initInvalid() {
  showError("Missing or invalid target URL.");
  urlBlockEl.hidden = true;
  rememberRowEl.hidden = true;
  subdomainsRowEl.hidden = true;
  rowListEl.hidden = true;
  footerTextEl.textContent = "Esc closes the tab.";
}

function renderUrlText() {
  const originEl = document.getElementById("origin-text");
  const pathEl = document.getElementById("path-text");
  const fullUrlEl = document.getElementById("full-url-text");
  const detailsEl = document.getElementById("full-url-details");

  const origin = stripBidiControls(targetUrl.origin);
  const pathAndSearch = stripBidiControls(targetUrl.pathname + targetUrl.search + targetUrl.hash);
  const fullUrl = stripBidiControls(targetUrl.href);

  originEl.textContent = origin;
  pathEl.textContent = pathAndSearch;
  fullUrlEl.textContent = fullUrl;
  detailsEl.hidden = pathAndSearch.length === 0;

  const rememberLabelEl = document.getElementById("remember-label");
  rememberLabelEl.textContent = "Remember for " + targetUrl.hostname;

  const hostBaseDomain = baseDomain(targetUrl.hostname);
  if (hostBaseDomain !== targetUrl.hostname) {
    const subdomainsLabelEl = document.getElementById("subdomains-label");
    subdomainsLabelEl.textContent = "Include all subdomains (" + hostBaseDomain + ")";
    subdomainsRowEl.hidden = false;
  } else {
    subdomainsRowEl.hidden = true;
  }
}

function createRow(key, colorHex, name, cookieStoreId, isCurrent) {
  const li = document.createElement("li");
  li.className = "option-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "option-card";
  if (key !== null) {
    button.setAttribute("aria-keyshortcuts", String(key));
  }

  // Leading indicator: a filled dot for containers with a color, a hollow
  // dot for the colorless default option.
  const dotEl = document.createElement("span");
  dotEl.className = colorHex ? "dot" : "dot dot--hollow";
  if (colorHex) {
    dotEl.style.backgroundColor = colorHex;
  }
  button.appendChild(dotEl);

  const nameEl = document.createElement("span");
  nameEl.className = "name";
  nameEl.textContent = name;
  button.appendChild(nameEl);

  const rightEl = document.createElement("span");
  rightEl.className = "option-right";

  if (isCurrent) {
    const currentLabelEl = document.createElement("span");
    currentLabelEl.className = "current-label";
    currentLabelEl.textContent = "Current space";
    currentLabelEl.setAttribute("aria-label", "Current space");
    rightEl.appendChild(currentLabelEl);
  }

  if (key !== null) {
    const keyEl = document.createElement("kbd");
    keyEl.className = "key-chip";
    keyEl.textContent = String(key);
    rightEl.appendChild(keyEl);
  }

  button.appendChild(rightEl);

  button.addEventListener("click", () => pick(cookieStoreId));

  li.appendChild(button);
  return li;
}

function focusFirstRow() {
  const firstButton = rowListEl.querySelector("button.option-card");
  if (firstButton) {
    firstButton.focus();
  }
}

function renderLoading() {
  keyMap.clear();
  rowListEl.textContent = "";
  const li = document.createElement("li");
  li.className = "row-status";
  li.textContent = "Loading containers…";
  rowListEl.appendChild(li);
}

function renderLoadError() {
  keyMap.clear();
  rowListEl.textContent = "";
  const li = document.createElement("li");
  li.className = "row-status";

  const message = document.createElement("p");
  message.textContent = "Could not load containers.";
  li.appendChild(message);

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "btn btn-ghost";
  retryButton.textContent = "Retry";
  retryButton.addEventListener("click", loadContainers);
  li.appendChild(retryButton);

  rowListEl.appendChild(li);
}

function renderRows(containers) {
  keyMap.clear();
  rowListEl.textContent = "";

  containers.forEach((container, index) => {
    const key = index < MAX_KEYED_CONTAINERS ? index + 1 : null;
    if (key !== null) {
      keyMap.set(key, container.cookieStoreId);
    }
    const colorHex = CONTAINER_COLORS[container.color] || null;
    const isCurrent = container.cookieStoreId === currentCookieStoreId;
    rowListEl.appendChild(
      createRow(key, colorHex, container.name, container.cookieStoreId, isCurrent)
    );
  });

  const isDefaultCurrent = currentCookieStoreId === DEFAULT_COOKIE_STORE_ID || currentCookieStoreId === "";
  keyMap.set(0, DEFAULT_COOKIE_STORE_ID);
  rowListEl.appendChild(
    createRow(0, null, "No container (default)", DEFAULT_COOKIE_STORE_ID, isDefaultCurrent)
  );

  focusFirstRow();
}

async function loadContainers() {
  renderLoading();
  try {
    const containers = await browser.runtime.sendMessage({ type: "getContainers" });
    renderRows(containers || []);
  } catch (err) {
    renderLoadError();
  }
}

async function pick(cookieStoreId) {
  if (picked || canceled) {
    return;
  }
  picked = true;

  const remember = document.getElementById("remember-checkbox").checked;
  const includeSubdomains = document.getElementById("subdomains-checkbox").checked;

  const message = {
    type: "pick",
    url: targetUrl.href,
    cookieStoreId,
    remember,
  };
  if (remember) {
    message.rememberDomain = includeSubdomains ? baseDomain(targetUrl.hostname) : targetUrl.hostname;
  }

  try {
    const response = await browser.runtime.sendMessage(message);
    if (!response || response.ok === false) {
      picked = false;
      showError((response && response.error) || "Could not open the container.");
    }
  } catch (err) {
    picked = false;
    showError(err && err.message ? err.message : String(err));
  }
}

async function cancel() {
  if (canceled) {
    return;
  }
  canceled = true;

  try {
    const response = await browser.runtime.sendMessage({ type: "cancel" });
    if (!response || response.ok === false) {
      canceled = false;
      showError((response && response.error) || "Could not close the tab.");
    }
  } catch (err) {
    canceled = false;
    showError(err && err.message ? err.message : String(err));
  }
}

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.isComposing) {
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    cancel();
    return;
  }

  if (targetUrl === null) {
    return;
  }

  if (event.key === "r" || event.key === "R") {
    event.preventDefault();
    const checkbox = document.getElementById("remember-checkbox");
    checkbox.checked = !checkbox.checked;
    if (!checkbox.checked) {
      document.getElementById("subdomains-checkbox").checked = false;
    }
    return;
  }

  if ((event.key === "s" || event.key === "S") && !subdomainsRowEl.hidden) {
    event.preventDefault();
    const checkbox = document.getElementById("subdomains-checkbox");
    checkbox.checked = !checkbox.checked;
    if (checkbox.checked) {
      document.getElementById("remember-checkbox").checked = true;
    }
    return;
  }

  if (/^[0-9]$/.test(event.key)) {
    const key = Number(event.key);
    if (keyMap.has(key)) {
      event.preventDefault();
      pick(keyMap.get(key));
    }
  }
});

function init() {
  if (targetUrl === null) {
    initInvalid();
    return;
  }

  renderUrlText();
  loadContainers();

  const rememberCheckboxEl = document.getElementById("remember-checkbox");
  const subdomainsCheckboxEl = document.getElementById("subdomains-checkbox");
  rememberCheckboxEl.addEventListener("change", () => {
    if (!rememberCheckboxEl.checked) {
      subdomainsCheckboxEl.checked = false;
    }
  });
  subdomainsCheckboxEl.addEventListener("change", () => {
    if (subdomainsCheckboxEl.checked) {
      rememberCheckboxEl.checked = true;
    }
  });

  browser.contextualIdentities.onCreated.addListener(loadContainers);
  browser.contextualIdentities.onUpdated.addListener(loadContainers);
  browser.contextualIdentities.onRemoved.addListener(loadContainers);

  window.focus();
}

init();
