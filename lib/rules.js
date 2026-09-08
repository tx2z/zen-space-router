// Pure helpers shared by background.js, picker.js and options.js. Loaded as a
// classic script in extension pages (exposes the single global
// `ZenSpaceRouterLib`) and as a CommonJS module under Node for tests.
(function () {
  "use strict";

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
    gray: "#7c7c7d",
    grey: "#7c7c7d",
  };

  // Bidi control characters (embeddings/overrides and isolates) that could be
  // used to make a URL render misleadingly; stripped before display. Written
  // as \u escapes, never as raw control characters, so the source stays
  // readable in editors/diffs and cannot be silently mangled by tooling.
  const BIDI_CONTROL_CHARS_RE = /[\u202A-\u202E\u2066-\u2069]/g;

  function stripBidiControls(text) {
    return text.replace(BIDI_CONTROL_CHARS_RE, "");
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
      // Reject hostnames that cannot become an own property of a plain
      // object ("__proto__", "constructor", ...), so callers can safely use
      // the result as a rules-map key without touching the prototype chain.
      if (Object.prototype.hasOwnProperty.call(Object.prototype, hostname)) {
        return null;
      }
      return hostname;
    } catch (err) {
      return null;
    }
  }

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

  const ZenSpaceRouterLib = {
    CONTAINER_COLORS,
    SECOND_LEVEL_SUFFIXES,
    stripBidiControls,
    baseDomain,
    normalizeDomain,
    findRule,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = ZenSpaceRouterLib;
  } else {
    globalThis.ZenSpaceRouterLib = ZenSpaceRouterLib;
  }
  // This file must stay loadable both as a classic script (extension pages,
  // via manifest `background.scripts`/`<script>`) and via `require()` under
  // Node for the test suite, hence the CommonJS-or-globalThis branch above
  // and the explicit `.call(globalThis)` below instead of relying on the
  // implicit `this` a plain function call would get in each environment.
}.call(globalThis));
