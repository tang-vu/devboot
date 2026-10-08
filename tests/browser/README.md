# Real-browser log-follow QA

This fixture imports the actual `Terminal` and its CSS. It uses synthetic
`LogRecord` arrays with session and sequence identities. All Tauri `invoke`
calls are aliased to a deny-all bridge. Its Start, Stop, Restart, Clear and
Reload controls only change React fixture state. It does not load App, user
projects, settings, external providers, or backend processes.

The browser suite uses the pinned `@playwright/test` development dependency.
The `npm run test:browser` script and Windows CI job run these tests in Chromium.
It is separate from the jsdom suite.

## Run

From the repository root, with the existing dependencies installed:

```sh
npx vite --config tests/browser/vite.config.mjs
```

Open `http://127.0.0.1:4179/tests/browser/log-follow.html` in a real browser.
The server deliberately listens on loopback only. The fixture title must say
“DevBoot synthetic log-follow QA.” Do not substitute an existing real app tab.

Run the automated real-browser suite from the repository root:

```sh
npx playwright install chromium
npm run test:browser
```

The suite starts its own loopback Vite process, so stop a manually started copy
first. Tests use real mouse wheel, native scrollbar drag, and keyboard input;
page evaluation reads DOM geometry only. It writes an HTML report to
`playwright-report` and attaches selected screenshots and geometry JSON. Failures
also retain a trace and screenshot in `test-results`. CI must run these tests on
the exact proposed commit before the geometry gate can be considered passed.

## Geometry observations

Use the browser's supported read-only DOM inspection after actual wheel,
scrollbar, keyboard and native button actions. Do not set `scrollTop` or dispatch
synthetic events through JavaScript to claim user-scroll acceptance. jsdom does
not prove this geometry.

The following expression captures the first partially visible log identity and
its pixel offset. With a retained anchor, compare `first.id` and `first.offset`
before and after each relevant change; allow 1 CSS pixel for rounding. Following
should have a bottom gap of at most 2 pixels after layout settles.

```js
(() => {
  const body = document.querySelector('.terminal-body');
  if (!body) return { closed: true };
  const top = body.getBoundingClientRect().top + body.clientTop;
  const lines = [...body.querySelectorAll('[data-log-id]')];
  const first = lines.find(line => line.getBoundingClientRect().bottom > top);
  return {
    scrollTop: body.scrollTop,
    clientHeight: body.clientHeight,
    scrollHeight: body.scrollHeight,
    bottomGap: body.scrollHeight - body.clientHeight - body.scrollTop,
    first: first && {
      id: first.getAttribute('data-log-id'),
      offset: first.getBoundingClientRect().top - top,
    },
    count: lines.length,
    status: document.querySelector('[role="status"]')?.textContent,
    summary: document.querySelector('.fixture-summary')?.textContent,
    notices: [...document.querySelectorAll('[role="alert"], .history-notice')].map(node => node.textContent),
  };
})()
```

## Acceptance sequence

1. Reset. Verify Following output and bottom alignment. Append one, 20 identical
   messages and 3 wrapped records; verify every record remains in the model and
   the viewport reaches the newest record. Start sustained output, inspect while
   output arrives, then stop it.
2. Reset. Scroll up with the mouse wheel. Verify Reading history / Resume live.
   Record the first visible identity and offset. Append each output shape and a
   sustained burst. The identity and offset must remain stable while retained.
3. Reset and pause with the explicit button while at the bottom. Append one,
   repeated and wrapped records. Verify it remains paused and retains its anchor.
4. Reset. Use a scrollbar drag to move into history, then verify paused state and
   retained anchor under append. Repeat with focused output region + PageUp/Home.
   Scrolling back to the bottom must not implicitly enable following.
5. With a retained paused anchor, insert a late record near the start, toggle the
   log error on/off, then show the error and use Reload synthetic snapshot.
   Verify the same anchor and offset across each layout change. Separately,
   navigate to the top error and use Terminal's native Reload logs button.
   Verify the error clears and the view stays paused. Navigating to that button
   legitimately changes the old deep-history anchor.
6. Reset. Scroll into history. Narrow/Widen and Shorter/Taller the view. Verify the
   first visible retained record and offset, including wrapped records. Repeat
   while following and verify bottom alignment. Also pause deeply inside a long
   row at narrow width and widen until the old negative offset lies beyond the
   shortened row. The same identity must remain first, aligned at the top; later
   output must retain that corrected position. While following, resize and
   immediately scroll upward with the wheel or PageUp without waiting for
   geometry to settle. The view must pause and honor that upward scroll.
7. Reset. Append 300 until capped, pause near the newest output, then Append 300
   once more. Confirm the model remains at 1,000 records and the retained anchor
   survives removal above it. Now Evict all old records. Verify paused mode and
   an honest unavailable-history notice; never claim the old identity survived.
8. Reset, pause, Clear, then append output. Verify paused state persists. Resume
   live must reach the newest record and remove the unavailable-history notice.
9. Reset, pause, replace backend session. The session identity must prevent
   matching old rows solely by sequence number. Verify paused state and the
   missing-history notice. Resume restores live following.
10. Reset, pause, switch projects, then switch back. Each keyed fresh view starts
    following. Close and reopen a paused terminal and verify the same reset.
    Synthetic Stop/Start/Restart in a still-mounted view must not reset its mode.
11. Operate Pause following and Resume live using keyboard Tab/Enter/Space.
    Verify meaningful accessible labels, status, and a keyboard-focusable output
    region. Capture screenshots of following, retained paused history, and lost
    history at both normal and narrower widths.

## Scope and limits

These checks establish Chromium DOM geometry and frontend behavior using the
real Terminal. They do not establish native Tauri/WebView2 behavior, OS process
delivery, a user's projects, or manual Windows desktop acceptance. Pure
state/unit tests and a successful bundle are not substitutes for a passing
browser run. A fixture build or test discovery alone must never be reported as
real-browser acceptance.
