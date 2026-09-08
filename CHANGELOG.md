# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.2] - 2026-09-08

### Added

- Automatic updates via a self-hosted update manifest (`updates.json` in
  this repository).

## [0.1.1] - 2026-09-08

First public release.

### Added

- Shared `lib/rules.js` module: pure helpers (`normalizeDomain`, `findRule`,
  `baseDomain`, `SECOND_LEVEL_SUFFIXES`, `stripBidiControls`,
  `CONTAINER_COLORS`) used by `background.js`, `picker.js` and `options.js`,
  loaded as a classic script and as a CommonJS module for tests.
- Test suite (`test/*.test.js`) with a fake `browser` API helper, and a CI
  workflow that runs `npm run check`, `npm test`, `npm run lint` and
  `npm run build` on every push and pull request.
- Documentation: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CLAUDE.md`,
  and `docs/` project notes.

### Changed

- `background.js`, `picker.js` and `options.js` now read the shared helpers
  off `lib/rules.js` instead of each keeping its own copy.

## [0.1.0] - 2026-09-08

Initial internal build. Signed by Mozilla on the unlisted channel but never
published.

### Added

- Interception of incoming external URLs via a blocking `webRequest.onBeforeRequest`
  listener, routing them to the Firefox container tied to a Zen workspace.
- Picker page shown when a URL has no matching rule, with keyboard shortcuts
  (`1`-`9` for the first nine containers, `0` for no container, `r` to
  remember, `s` to include subdomains, `Esc` to cancel).
- Rule matching by hostname with subdomain fallback, and a base-domain guess
  for the "include all subdomains" option.
- Options page listing, editing and removing domain rules, plus a toggle for
  unmatched external links and a separate toggle for routing typed URLs,
  styled to match Zen's own Space Routing Settings dialog.
- Signed, unlisted Mozilla Add-ons release process for self-distribution via
  a downloadable `.xpi`.

[Unreleased]: https://github.com/tx2z/zen-space-router/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/tx2z/zen-space-router/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/tx2z/zen-space-router/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/tx2z/zen-space-router/compare/d9260c4...v0.1.0
