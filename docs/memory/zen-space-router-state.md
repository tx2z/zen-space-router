---
name: zen-space-router-state
description: Status of the zen-space-router WebExtension as of 2026-09-08, release state and what remains open
metadata:
  type: project
---

As of 2026-09-08, version 0.1.0 was signed by Mozilla (unlisted channel) and
installed permanently in Zen, but was never published as a public release.
Version 0.1.1 is the first public release: signed, attached to the GitHub
release v0.1.1, and the repository was made public the same day.

The picker matches Zen's floating URL bar geometry (width = viewport / 1.5
capped at 750px, centred as if at least 333px tall, taken from
`ZenUIManager.mjs` and `zen-omnibox.css` in `zen-browser/desktop`); the
options page mirrors Zen's native "Space Routing Settings" dialog
(`zen-space-routing.css`).

**Why:** Zen has no workspace API. Recent Zen versions also ship a native,
silent Space Routing stored in `zen-space-routing.jsonlz4` that extensions
cannot read or write, so the extension's value is the picker and
remember-by-domain.

See docs/TECHNICAL.md for the current list of what is verified in Zen ("How
it works" table) and what remains unverified ("Not verified"); this file
does not duplicate those lists. For the release checklist, see CLAUDE.md.
