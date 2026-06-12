# Live QA — Workday Diagnostics Overlay

The extension ships a hidden diagnostics overlay for manual QA against real Workday tenants. It is **off by default** and never appears in normal use.

## Activating the overlay

Append `?aplyer_debug=1` to any URL the extension runs on:

```
https://acme.wd5.myworkdayjobs.com/en-US/External/job/123?aplyer_debug=1
```

Once activated, the overlay persists across SPA navigations via `localStorage["aplyer_debug"] = "1"`. Click the `×` button on the overlay to disable and clear the flag.

Alternatively, in DevTools console on the target page:

```js
localStorage.setItem("aplyer_debug", "1"); location.reload();
```

## What it shows

The floating panel (top-right, `z-index: 2147483647`) reports, refreshing every 750 ms:

- Adapter name, adapter version, adapter API version, orchestrator version
- ATS detection status and detection source (`host` vs. DOM-signature fallback)
- Questions detected, buttons injected, unique stable IDs
- Mutation events seen by the orchestrator, total scans, last scan time
- Current URL
- Tail of the last 30 stable IDs (for spotting duplicate-id regressions)
- Tail of the last 50 errors / warnings emitted by the content scripts

## Copy / Export

- **Copy** — copies the full diagnostics blob to the clipboard as JSON.
- **Export** — downloads `aplyer-diagnostics-<timestamp>.json`.

Both payloads include: capture timestamp, URL, user agent, adapter/orchestrator versions, all counters, the live stable-ID list, and the recent error tail. Attach the exported file to any bug report.

## Suggested live-QA matrix

For each tenant you test, capture the export and record:

| Field           | Source in overlay         |
| --------------- | ------------------------- |
| Detection       | "Detection" row           |
| Questions       | "Questions detected" row  |
| Buttons         | "Buttons injected" row    |
| Errors          | "Errors / warnings" list  |
| Notes           | (free text)               |

## Failure modes to specifically probe

1. **Multi-step applications** — Click "Save and Continue"; verify `Mutation events` increases and `Questions detected` updates.
2. **Validation re-renders** — Submit with a required field empty; the stable ID for that field must not change.
3. **Embedded iframes** — Confirm a question is still detected when the apply form lives inside an iframe.
4. **Rich-text fields** — A `contenteditable` cover-letter style field must appear with type `rich_text` and not as a duplicate.
5. **Hidden labels** — Some tenants render the prompt only via `aria-labelledby`; verify the label text appears in the panel.
6. **Dynamic section loading** — Tab/accordion sections that mount on click should add to the count without re-injecting prior buttons.
