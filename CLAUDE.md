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
  `baseDomain`.
- `picker.html/js` – page shown in place of the intercepted URL. Keys 1–9,
  0 = default container, `r` remember, `s` include subdomains, Esc cancel.
  Styled to match Zen's floating URL bar (see `style.css` `.picker-slot`).
- `options.html/js` – global toggle, "route typed URLs" toggle, rules table.
  Rule writes go through background messages `setRule` / `deleteRule`.
- `style.css` – shared tokens; values come from zen-browser/desktop
  `zen-theme.css`, `zen-panels/dialog.css`, `zen-omnibox.css`.
- `lib/rules.js` – pure helpers shared by `background.js`, `picker.js` and
  `options.js` (see "Working rules" below for how it's loaded).
- `test/` – Node test-runner suite (`test/*.test.js`) plus
  `test/helpers/fake-browser.js`, a minimal fake of the WebExtension
  `browser` global.
- `.github/workflows/ci.yml` – runs `npm run check`, `npm test`,
  `npm run lint` and `npm run build` on push and pull request.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE` – project
  docs; keep `CHANGELOG.md` updated on every version bump.
- `docs/` – screenshots, `docs/TECHNICAL.md`, and project memory notes
  (`docs/memory/`).
- `probe/` – logging-only extension used for the behaviour experiments.
  Keep it; do not add logic to it.
- `README.md` – short, plain-language install and usage guide.
- `docs/TECHNICAL.md` – how it works, detection evidence table, and the
  "Limitations" / "Not verified" sections. Update those sections whenever a
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
- Checks: `npm run check` (`node --check` on background.js, picker.js,
  options.js, lib/rules.js) and `node -e
  "JSON.parse(require('fs').readFileSync('manifest.json'))"`. `npm test`
  runs the Node test-runner suite in `test/`.
- Pure helpers (`normalizeDomain`, `findRule`, `baseDomain` +
  `SECOND_LEVEL_SUFFIXES`, `stripBidiControls`, `CONTAINER_COLORS`) live in
  `lib/rules.js`, not duplicated in background.js/picker.js/options.js.
  Those files read them off the `ZenSpaceRouterLib` global (destructured at
  the top of the file), e.g. `const { findRule, normalizeDomain } =
  ZenSpaceRouterLib;`. `lib/rules.js` is a classic script (loaded via
  `<script>`/manifest `background.scripts` before its consumers) that also
  exports itself as a CommonJS module for `test/rules.test.js`; keep it
  compatible with both when editing it. This is also why the background
  has exactly two scripts, `lib/rules.js` then `background.js`: classic
  scripts share one global scope, and two scripts each declaring the same
  top-level `const` would collide, hence the single `ZenSpaceRouterLib`
  object instead.
- The extension can only be exercised in Zen on the user's machine. After
  changes, ask the user to click Reload in `about:debugging`, give exact
  `open https://...` commands, and say which `[zen-space-router]` console
  lines to paste back.

## Releases and signing

- Zen only installs signed extensions permanently. Signing goes through
  Mozilla (addons.mozilla.org), channel `unlisted` for self-distribution.
- Release checklist:
  1. Bump `version` in `manifest.json`, `package.json` and `CHANGELOG.md`
     (Mozilla rejects a version that was already signed, even for
     unlisted).
  2. Add the new version to `updates.json` (`version` and `update_link` to
     the release asset).
  3. `npm run lint` must report 0 errors and 0 warnings.
  4. `npm run build` produces the zip in `web-ext-artifacts/`
     (gitignored); `web-ext-config.mjs` excludes `probe/` and repo metadata.
  5. Sign with the command in `docs/TECHNICAL.md` ("Releasing"). Credentials come from the maintainer's
     password manager, exported as `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`;
     never write them to disk or into the repo.
  6. The signed `.xpi` lands in `web-ext-artifacts/` under a hash-based
     name; rename it to `zen-space-router-<version>.xpi` and attach it to a
     GitHub release.
- Signed so far: 0.1.0 (2026-09-08, unlisted, internal — never released
  publicly), 0.1.1 (2026-09-08, unlisted — first public release), 0.1.2
  (2026-09-08, unlisted — first version with `update_url`, for automatic
  updates).
- `manifest.json` carries `data_collection_permissions: { required: ["none"] }`
  (required by Mozilla for new extensions) and `strict_min_version` 142
  because that key only exists from Firefox 142.
- `web-ext` is always run via `npx -y`; do not add it as a dependency.
