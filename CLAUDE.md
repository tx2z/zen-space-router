# zen-space-router

Firefox/Zen Browser WebExtension (Manifest v2, plain JS, no build step, no
dependencies) that routes incoming external URLs to a Zen space. Zen has no
workspace API, so "open in space X" means opening the tab with the
`cookieStoreId` of the container assigned to that space; Zen's
"switch to workspace where container is set as default" setting does the rest.

## Layout

- `manifest.json` – MV2, persistent background, permissions include
  `cookies` (required for `cookieStoreId` in `tabs.create`) and
  `webRequestBlocking`.
- `background.js` – interception and routing. Entry point is the blocking
  `webRequest.onBeforeRequest` listener (`main_frame`). Rule matching is
  `findRule`; domain normalisation is `normalizeDomain`; base-domain guess is
  `baseDomain` (duplicated in `picker.js`, keep both in sync).
- `picker.html/js` – page shown in place of the intercepted URL. Keys 1–9,
  0 = default container, `r` remember, `s` include subdomains, Esc cancel.
  Styled to match Zen's floating URL bar (see `style.css` `.picker-slot`).
- `options.html/js` – global toggle, "route typed URLs" toggle, rules table.
  Rule writes go through background messages `setRule` / `deleteRule`.
- `style.css` – shared tokens; values come from zen-browser/desktop
  `zen-theme.css`, `zen-panels/dialog.css`, `zen-omnibox.css`.
- `probe/` – logging-only extension used for the behaviour experiments.
  Keep it; do not add logic to it.
- `README.md` – install, Zen setup, detection evidence table, and the
  "Known limitations / not verified" list. Update that list whenever a
  behaviour is confirmed or a new assumption is introduced.

## Detection facts (verified in Zen, do not re-derive)

- External tab: `tabs.onCreated` with `about:blank`, no `openerTabId`,
  `active: false`, cookieStoreId of the active space. `onBeforeRequest`
  fires 7–60 ms later with a valid `tabId`, before `onBeforeNavigate`.
- Page-initiated tabs (window.open, Cmd-click) have `details.originUrl`.
  Cmd-click tabs have NO `openerTabId`; `originUrl` is the signal.
- Typed URL in a new tab looks identical except `active: true`.
- Extension-created tabs also arrive with an origin, so own-tab tracking
  (`ownPendingUrls`) must run before the origin guard.
- `transitionType` is `link` for everything; useless.

## Working rules

- Code, comments and UI strings in English. Comments say what the code
  does.
- Never use `innerHTML`; build DOM with `createElement` / `textContent`.
- No inline scripts or handlers (MV2 default CSP).
- Checks: `node --check background.js picker.js options.js` and
  `node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"`.
- The extension can only be exercised in Zen on the user's machine. After
  changes, ask the user to click Reload in `about:debugging`, give exact
  `open https://...` commands, and say which `[zen-space-router]` console
  lines to paste back.
