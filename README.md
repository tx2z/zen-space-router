# Zen Space Router

> **Built with AI.** This extension was written by [tx2z](https://github.com/tx2z)
> with substantial help from Claude (Anthropic). The code was reviewed and
> tested by a human in a real Zen Browser, but if you are not comfortable
> using AI-assisted software, please do not use it.

A Firefox/Zen Browser extension that routes external links to the right Zen
workspace. When something outside the browser (a terminal, Slack, Teams, an
email client...) opens a link, this shows a picker so you choose which
workspace it should land in — or, once you've picked once, it just opens
there automatically.

## Why

Zen Browser has no public workspace API. Each Zen workspace can be tied to a
Firefox container, though, and Zen already auto-switches to the workspace
whose container a tab uses. This extension uses that as a proxy: "open URL
in workspace X" becomes "open a tab with the `cookieStoreId` of the
container assigned to workspace X".

Recent Zen versions ship their own native Space Routing, but it's silent and
rule-only — it moves a tab to a space with no confirmation and no way to
decide on the spot. This extension adds the missing "ask me" flow: a picker
for domains you haven't routed yet, plus a one-key way to remember the
choice.

## Screenshots

![Picker](docs/screenshots/picker.png)
The picker shown for an external link with no matching rule yet.

![Options](docs/screenshots/options.png)
The options page, listing saved domain rules.

## Requirements

Zen built on Firefox 142 or newer. Check `about:support` → "Application
Basics" → "Build ID"/"Firefox" version if unsure; older builds refuse to
install this extension.

## Install

### From a release (recommended)

1. Download `zen-space-router-<version>.xpi` from the [Releases
   page](https://github.com/tx2z/zen-space-router/releases).
2. Drag it onto a Zen window, or open `about:addons` → the gear menu →
   "Install Add-on From File" and select it.

Releases are signed by Mozilla, so they install permanently.

### Temporarily, from source

1. Open `about:debugging#/runtime/this-firefox` in Zen.
2. Click "Load Temporary Add-on…".
3. Select `manifest.json` in this repository.

Temporary add-ons are removed when the browser restarts; you'll need to
reload it each session, or use a signed `.xpi` for a permanent install.

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
- One row per container, with a coloured dot (hollow if the container's
  colour is not recognised) and a key hint (`1`-`9` for the first nine
  containers; extra containers are still clickable).
- A `0` row for "No container (default)".
- A "Current space" badge on whichever container the tab already has.

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
domain field, a container dropdown, and a remove button. Edits to the
domain field save when you press Enter or move focus away; container
changes save immediately once the row's domain has been saved. A domain
that cannot be parsed is highlighted and not saved. "New rule" adds a
blank row; leaving it empty discards it. The footer has an "Unmatched
external links" dropdown ("Ask me" vs. "Leave in current space", i.e. the
enable/disable toggle) and the "Also ask for URLs typed into a new tab"
checkbox.

### Zen's native Space Routing

Recent Zen versions ship their own built-in Space Routing (the feature
landed in Zen's `dev` branch in August 2026, see `src/zen/space-routing/`
in github.com/zen-browser/desktop), which silently moves a tab to a space
with no picker. The setting lives at Zen Settings → Spaces → Space
Routing. To avoid double routing, do not create a native Zen route for a
domain that already has a rule here, and leave Zen's "Default route for
external links" setting on "Most recent Space". This extension's value
over the native feature is the picker (for domains with no rule yet) and
the remember-by-domain workflow that builds the rule table for you.

## How it works

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
| `window.open()` from a page | set (65 in the experiment) | set | varies | originUrl present → treated as page-initiated, ignored |
| Cmd-click a link | none | set | varies | originUrl present → treated as page-initiated, ignored |
| Cmd+T then type a URL | none | none | `true` | active tab → treated as typed, ignored unless `routeTypedUrls` is on |

## Limitations

- Background tabs opened without an origin can produce false positives:
  Alt+Enter in the URL bar, middle-click on a bookmark, "Open All in Tabs",
  and tabs created by other extensions can all look like an external link
  and trigger the picker.
- Firefox-restricted domains (`addons.mozilla.org`, `accounts.firefox.com`,
  and similar) cannot be intercepted by any extension, including this one.

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
- Whether Zen's native Space Routing runs before this extension is
  consulted (inferred from Zen's source, not observed).

## Development

```
npm run check   # node --check on every script (incl. probe/background.js) + manifest.json parse
npm test        # node --test test/*.test.js
npm run lint    # npx -y web-ext lint --warnings-as-errors
npm run build   # npx -y web-ext build, writes web-ext-artifacts/
```

CI runs the same four commands on every push to `main` and on every pull
request, and additionally asserts the built package's contents.

To try changes in Zen, load the repo as a temporary add-on
(`about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" →
select `manifest.json`); reload it after each edit.

`probe/` is a separate, logging-only extension used to gather the
empirical facts (tab creation order, presence of `originUrl`, etc.) that
this extension's detection heuristics are built on. It has no routing
logic of its own; keep it around for future experiments rather than adding
logic to it.

## Releasing

1. Bump `version` in both `manifest.json` and `package.json` (Mozilla
   rejects re-signing a version that was already signed, even on the
   unlisted channel).
2. Update `CHANGELOG.md` with the new version and its date.
3. `npm run lint` must report 0 errors and 0 warnings.
4. Export the AMO API key pair from your password manager:

   ```
   export WEB_EXT_API_KEY="$(op read 'op://<vault>/<item>/<field>')"
   export WEB_EXT_API_SECRET="$(op read 'op://<vault>/<item>/<field>')"
   ```

   The `op` command above is a generic placeholder for whichever password
   manager CLI you use; `web-ext` reads both variables automatically.
5. Sign the build:

   ```
   npx -y web-ext@8 sign --channel unlisted
   ```

   `unlisted` returns a signed `.xpi` for self-distribution (drag it onto a
   Zen window or open it from `about:addons`). Use `--channel listed` to
   publish on addons.mozilla.org instead.
6. `web-ext` writes the signed `.xpi` to `web-ext-artifacts/` under a
   hash-based name; rename it to `zen-space-router-<version>.xpi`.
7. Attach the renamed `.xpi` to a GitHub release.

## Privacy

Zen Space Router collects no data and makes no network requests. Rules and
settings live entirely in `browser.storage.local`, on your machine.

Permissions requested and why:

| Permission | Reason |
|---|---|
| `webRequest` | Needed, together with `webRequestBlocking`, to register the `onBeforeRequest` listener that inspects the target URL. |
| `webRequestBlocking` | Needed to cancel the original request before the page loads, so the picker or the routed tab can replace it. |
| `<all_urls>` | Same as above — the blocking listener has to be able to match any external URL. |
| `cookies` | Required by Firefox to open a tab with a specific `cookieStoreId` (container). |
| `contextualIdentities` | To list the containers shown in the picker and the options page. |
| `tabs` | To create, update, and close tabs during routing. |
| `storage` | To persist rules and settings in `browser.storage.local`. |

## Contributing and credits

Made by [tx2z](https://github.com/tx2z) with the help of Claude, for the
Zen Browser community. Bug reports, feature requests, pull requests, design
suggestions and ideas are all welcome: open an issue or a PR on GitHub. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to run the checks and test in Zen.

## License

MIT, see [LICENSE](LICENSE).
