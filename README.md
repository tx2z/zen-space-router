# Zen Space Router

## What it does

Zen Browser has no public workspace API, but each Zen workspace can be tied
to a Firefox container, and Zen auto-switches to the workspace whose
container a tab uses. This extension intercepts incoming external URLs
(from Slack, a terminal, etc.), and either opens them directly in the
container mapped to their domain, or shows a picker so you can choose. In
other words, "open URL in workspace X" is implemented as "open a tab with
the cookieStoreId of the container assigned to workspace X".

## Install temporarily

1. Open `about:debugging#/runtime/this-firefox` in Zen.
2. Click "Load Temporary Add-on…".
3. Select `manifest.json` in this repository.

Temporary add-ons are removed when the browser restarts; you will need to
reload it each session, or package it for permanent installation.

## Zen setup

1. In each Zen workspace's settings, assign a container to that workspace.
2. In Zen settings, enable "Switch to workspace where container is set as
   default when opening container tabs".
3. Set Zen as your default browser so external links (from Slack, a
   terminal, etc.) land in it.

## Usage

When an external URL has no matching rule, a picker tab opens showing:

- The hostname as the title line, with the full URL underneath as a
  muted subtitle (hover it to see the whole URL when it is truncated).
- One row per container, with a colored dot and a key hint (`1`-`9` for the
  first nine containers; extra containers are still clickable).
- A `0` row for "No container (default)".
- A "current" badge on whichever container the tab already has.

Press the matching digit, or click a row, to open the URL in that
container. Press `Esc` to close the tab without opening anything. Press `r`
to toggle "Remember for `<hostname>`" before picking, to save a rule so
future URLs on that domain skip the picker. A rule for a domain also
matches all of its subdomains: a rule for `example.com` applies to
`a.example.com` and `b.a.example.com` too, but not to unrelated domains
like `notexample.com`.

When the target URL's hostname has a guessable base domain (e.g.
`m.facebook.com` -> `facebook.com`), a second checkbox, "Include all
subdomains (`<baseDomain>`)", appears below the remember checkbox. Press
`s` to toggle it, or check it directly; ticking it also ticks "Remember",
and unticking "Remember" unticks it. When ticked, the saved rule uses the
base domain instead of the exact hostname. The base-domain guess uses a
short built-in list of second-level suffixes (e.g. `co.uk`), not the
public suffix list, so unusual TLD structures may need manual editing on
the options page.

The options page (accessible from `about:addons`) looks like Zen's own
"Space Routing Settings" dialog. Each row is a domain rule: an editable
domain field, a container dropdown, and a remove button; edits save as you
type (Enter or clicking away) or as soon as you change the dropdown. "New
rule" adds a blank row; leaving it empty discards it. The footer has an
"Unmatched external links" dropdown ("Ask me" vs. "Leave in current
space", i.e. the enable/disable toggle) and the "Also ask for URLs typed
into a new tab" checkbox.

### Zen's native Space Routing

Zen ≥ 1.21.16b (August 2026) ships its own built-in Space Routing, which
silently moves a tab to a space with no picker. To avoid double routing, do
not create a native Zen route for a domain that already has a rule here,
and leave Zen's "Default route for external links" setting on "Most recent
Space". This extension's value over the native feature is the picker (for
domains with no rule yet) and the remember-by-domain workflow that builds
the rule table for you.

## How detection works

Interception happens in `browser.webRequest.onBeforeRequest` (with
`["blocking"]`, filtered to `main_frame`), because it fires before
`webNavigation.onBeforeNavigate`; cancelling the request there prevents the
real page from ever loading.

A request is treated as an incoming external URL when all of these hold:
no `originUrl` and no `documentUrl` on the request, the tab was seen
arriving with an empty/`about:blank` URL within the last 10 seconds, the
tab has no `openerTabId`, and (unless "route typed URLs" is enabled) the
tab is not `active`.

| Scenario | openerTabId | originUrl | active | Signals used |
|---|---|---|---|---|
| External `open` (terminal, Slack, etc.) | none | none | `false` | fresh blank tab + no opener + no originUrl + inactive → routed |
| `window.open()` from a page | none | set | varies | originUrl present → treated as page-initiated, ignored |
| Cmd-click a link | none | set | varies | originUrl present → treated as page-initiated, ignored |
| Cmd+T then type a URL | none | none | `true` | active tab → treated as typed, ignored unless `routeTypedUrls` is on |

## Not verified

- `active: false` for external links was observed with `open` from the
  macOS terminal and with links clicked in Microsoft Teams. Other apps
  (Slack, Todoist, PDF viewers) are expected to behave the same but were
  not tested.
- Behaviour with multiple Zen windows open at once.
- Whether tabs routed to `firefox-default` (no container) stay in the
  current workspace or move somewhere else.
- Whether a cancelled `main_frame` request ever briefly shows an error page
  before the picker tab replaces it.
- The order in which `tabs.onCreated` fires before `onBeforeRequest` was
  observed during testing, not guaranteed by the API; if it ever fired the
  other way round, the fresh-tab heuristic this extension relies on would
  miss that tab.
- Manifest v3 was not evaluated. Firefox's MV3 still supports blocking
  `webRequest`, but it does not support a persistent background page; the
  in-memory state this extension keeps (`freshTabs`, `ownTabs`,
  `ownPendingUrls`, the settings cache) would need to move to
  `storage.session` or be rebuilt to survive an event page being suspended.

## Known limitations

- Background tabs opened without an origin can produce false positives:
  Alt+Enter in the URL bar, middle-click on a bookmark, "Open All in Tabs",
  and tabs created by other extensions can all look like an external link
  and trigger the picker.
- Firefox-restricted domains (`addons.mozilla.org`, `accounts.firefox.com`,
  and similar) cannot be intercepted by any extension, including this one.

## Packaging and signing

Zen, like Firefox, only installs signed extensions permanently. Packaging
uses Mozilla's `web-ext` tool through `npx`, so nothing is added to the
repository; `web-ext-config.mjs` holds the shared options.

```
npx -y web-ext lint    # validation, must report 0 errors
npx -y web-ext build   # writes web-ext-artifacts/zen_space_router-<version>.zip
```

To get an installable `.xpi`, sign the build with Mozilla:

1. Create API credentials at
   https://addons.mozilla.org/developers/addon/api/key/ (requires a Firefox
   account).
2. Run the signing command. With the credentials stored in 1Password
   (item "Mozilla Add-ons API", fields `username` = JWT issuer and
   `credential` = JWT secret), `op` injects them without writing them to
   disk:

   ```
   npx -y web-ext sign --channel unlisted \
     --api-key "$(op read 'op://Private/Mozilla Add-ons API/username')" \
     --api-secret "$(op read 'op://Private/Mozilla Add-ons API/credential')"
   ```

   `unlisted` returns a signed `.xpi` for self-distribution (drag it onto a
   Zen window or open it from `about:addons`). Use `--channel listed` to
   publish on addons.mozilla.org instead.
3. Bump `version` in `manifest.json` before signing again; Mozilla rejects
   a version that was already signed.

## Files

- `manifest.json` — extension manifest.
- `background.js` — interception logic, routing, and message handling.
- `picker.html` / `picker.js` — the container picker shown when no rule matches.
- `options.html` / `options.js` — the settings and rules page.
- `style.css` — shared styling for the picker and options pages.
- `icons/icon.svg` — extension icon.
- `web-ext-config.mjs` — packaging options for `web-ext`.
- `probe/` — a separate, logging-only extension used to gather the
  empirical facts this extension is designed around; not part of the
  router itself.
