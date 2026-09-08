# Contributing

Zen Space Router is plain JS with no build step and no dependencies. Keep it
that way.

## Checks

```
npm run check   # node --check on every script (incl. probe/background.js) + manifest.json parse
npm test        # node --test test/*.test.js
npm run lint    # npx -y web-ext lint --warnings-as-errors
```

Run all three before opening a PR; `npm run check`, `npm test` and
`npm run lint` must stay green. CI runs the same three checks, plus
`npm run build`, on every push and pull request. `npm run build` produces
the packaged zip in `web-ext-artifacts/` (gitignored) for manual testing,
same as a release build.

## Testing in Zen

The extension can only be fully exercised inside Zen, since it depends on
Zen's workspace/container behaviour:

1. Open `about:debugging#/runtime/this-firefox` in Zen.
2. Click "Load Temporary Add-on…" and select `manifest.json`.
3. Trigger an external open the way a real app would, e.g. from a terminal:
   ```
   open https://example.com
   ```
4. Inspect the background console: `about:debugging` → this add-on →
   "Inspect". Background log lines are prefixed `[zen-space-router]`.

Temporary add-ons are removed on browser restart, so reload after each Zen
session.

## Coding rules

- Plain JS, no build step, no runtime dependencies.
- Never use `innerHTML`; build DOM with `createElement` / `textContent`.
- No inline scripts or event handlers (the extension relies on the MV2
  default CSP).
- Comments describe what the code does, in English, not why a change was
  made — history belongs in git.
- Manifest V2 is kept deliberately (Zen/Firefox still support blocking
  `webRequest` under MV2, and MV3's lack of a persistent background page
  would require reworking the in-memory state this extension relies on).
- The background has exactly two scripts, `lib/rules.js` and
  `background.js`, loaded in that order as classic scripts. Classic scripts
  share one global scope, so `lib/rules.js` exposes its helpers under a
  single `ZenSpaceRouterLib` object rather than top-level `const`s — two
  scripts declaring the same top-level `const` would collide.

## Adding tests

Add a `test/<name>.test.js` file using Node's built-in test runner
(`node:test` / `node:assert`); `npm test` picks up every `test/*.test.js`
file automatically. Tests that need the WebExtension APIs use the fake
`browser` implementation in `test/helpers/fake-browser.js` instead of a
real browser.

## Pull requests

Keep `npm run check`, `npm test` and `npm run lint` passing. Describe the
behaviour change and, if it touches interception or routing logic, how you
verified it in Zen.
