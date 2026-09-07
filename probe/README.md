# zen-space-router probe

Minimal Firefox extension that only logs browser events to the background
console. It does not implement any routing logic.

## Loading the extension

1. Open `about:debugging#/runtime/this-firefox` in Firefox (or Zen).
2. Click "Load Temporary Add-on".
3. Pick `probe/manifest.json`.
4. Click "Inspect" next to the loaded extension to open its background
   console. All `[probe ...]` log lines will appear there.

## Test scenarios

For each scenario, run it from within a Zen workspace that has a container
assigned, note which workspace/container was active, and paste the console
output.

- **A.** Click an http(s) link from an external app (e.g. Slack, or run
  `open https://example.com` in a terminal).
- **B.** From a normal page, run `window.open("https://example.org")` in the
  page's devtools console.
- **C.** From a normal page, middle-click or Cmd-click a link.
- **D.** Open a new tab with Cmd+T and type a URL.
