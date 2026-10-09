# Synthetic browser QA

## Project detection ownership

The separate `project-detection.html` fixture renders the actual `App`,
`AddProject`, and project hook under root StrictMode. It listens on loopback port
4181 using `project-detection-vite.config.mjs`, with a separate bridge and CSP.
The log-follow and Settings fixtures retain their independent bridges and ports.

Only a fixed set of synthetic folder names is accepted. Settings and the initial
empty project list are in memory; folder pickers, detection, add, and update
requests are held promises settled by native fixture buttons. Successful add and
update requests change only the fixture-owned project list. Any resulting status
and log reads return synthetic stopped/empty data. The retained JSON ledger
captures every request, payload, completion, and denied operation. Per-operation
names and commands distinguish an old result for A from a new result for A.

The strict bridge rejects unknown commands, unexpected keys, non-synthetic
paths/project IDs, real dialogs, clipboard access, and URL opening. It never
imports or forwards Tauri APIs, reads backend source/state, loads user projects,
or launches commands. The isolated Vite config rejects unaliased native imports
and removes the remote font import. CSP plus the browser suite's request guard
restrict traffic to the fixture's loopback origin and fail unexpected requests
or popups. No credentials or user files are used.

`project-detection.spec.ts` uses mouse clicks, keyboard input, and native wheel
scrolling. Tests never dispatch DOM events or inject application state. Folder
paths, picker results, and projects are synthetic data held in memory; no files
are selected, read, or changed. Tests cover:

- Older success/failure before and after a newer result; A → B → A ownership
- Debounce cancellation, path clearing, shorter paths, trailing separators, and
  closing/reopening before the timer fires
- Manual name/command edits and templates during pending detection, deliberate
  suggestion selection, and clearing old generated commands for no suggestions
- Detection failure, explicit retry/manual recovery, disabled Save/Enter paths,
  and exact add/update IPC payloads including environment values and options
- Held picker selection, failure, cancellation/resumption, duplicate prevention,
  and typed paths superseding the picker
- Cancel, close, Escape, and backdrop dismissal followed by reopening; old
  picker/detection/save completions cannot mutate or dismiss the new form
- Failed save retaining its full draft for retry and the actual App edit route
- Panel, header, footer, and control containment at 1280×900 and 1280×640;
  native wheel and Tab reach recovery controls and bottom fields while only the
  form body scrolls, including a fixed eight-suggestion result; the form itself,
  header, and footer stay fixed

Each test attaches its synthetic ledger; selected cases also attach current
generation, manual edits, failure, and recovery screenshots. Geometry
cases attach read-only measurements and pending/error/recovery/tall-content
screenshots at both viewport sizes. Final panel/form/body/fieldset/control measurements
are attached even if containment or actionability fails before a state capture.

Textarea access has separate pointer and keyboard checks. Native wheel scrolling
must expose the complete textarea and its center for pointer editing. Native Tab
must focus an unobscured text line and support actual editing and restoration. A hosted run
failed the earlier expectation that Tab would expose every empty textarea row:
Chromium kept the focused first line visible while lower rows remained clipped.
The suite retains full-control bounds and hit checks before and after wheel
scrolling, plus independent first-line geometry and exact keyboard edit checks.

OS file-drop transport is not covered by this browser suite. The hosted Chromium
attempts delivered trusted drop events with an empty file list for both
renderer-created and file-input-backed Files, so the unsupported harness was
removed. Those attempts failed; they are not browser acceptance. Deterministic
component tests in `tests/project-detection.test.tsx` retain drop ownership/race
coverage, which does not establish Windows Explorer, Tauri file-drop, or native
folder-picker behavior.

Run only
this suite with `npm run test:browser -- project-detection.spec.ts`. To build the
isolated fixture without starting a browser:

```sh
npx vite build --config tests/browser/project-detection-vite.config.mjs --outDir /tmp/devboot-project-detection-fixture
```

Passing type checks, fixture builds, or test discovery does not establish browser
acceptance. Run Chromium on the exact proposed commit before marking these
frontend gates passed. The suite does not establish real filesystem detection,
native folder-picker behavior, Windows/WebView2 behavior, real persistence, or
OS process execution.

## Settings lifecycle

The separate `settings.html` fixture imports the actual `App`, `Settings`, and
`useSettings`, with the same root StrictMode replay as the app entry point. It
runs on loopback port 4180 using `settings-vite.config.mjs`; the log-follow server
and its deny-all bridge remain separate and unchanged.

The Settings fixture aliases core, event, and dialog APIs to a strict in-memory
bridge. It returns empty projects, registers inert listeners only for the three
known process event names, and holds settings reads, writes, and startup requests
as promises. Native fixture buttons explicitly resolve or reject each promise.
Every call and payload remains in the attached JSON ledger, including rejected
and denied requests. The fixture rejects any unexpected command or payload,
native dialog, clipboard write, or URL opening; no operation reaches Tauri,
configuration files, the registry, startup integration, or a project process.
Its isolated Vite configuration removes the App CSS remote-font import, rejects
unaliased Tauri imports, and serves a page with a restrictive CSP. Browser tests
also block and fail unexpected network requests or popups.

`settings.spec.ts` uses native mouse and keyboard input to cover:

- Loading and failure preventing edits/save, followed by explicit read retry
- Keyboard focus, Space/Enter toggles, and exact selected preference values
- Preference-write failure/retry with the exact payload and no early startup call
- Partial startup failure, warning persistence across reopening, and recovery
- Cancel, close button, Escape, and backdrop dismissal during both pending stages
- Frozen fields and duplicate submission prevention across dismissal/reopening
- An old save completion leaving a new dialog open; full success closing the
  dialog that submitted that save

Hosted Chromium runs attach loading, read-error, preference-write-error,
partial-startup-error, and recovered screenshots, plus each test's full synthetic
command ledger. The existing pinned Playwright dependency and CI browser command
discover all three suites. Type checking, building this fixture, or test discovery
alone does not establish browser acceptance. These tests do not establish native
Windows startup behavior or real settings persistence.

## Log-follow fixture

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

The suite starts its own isolated loopback Vite servers, so stop manually started
copies first. Tests use real mouse wheel, native scrollbar drag, and keyboard input;
page evaluation reads DOM geometry only. It writes an HTML report to
`playwright-report` and attaches selected screenshots and geometry JSON. Failures
also retain a trace and screenshot in `test-results`. CI must run these tests on
the exact proposed commit before the geometry gate can be considered passed.
The configuration omits Chromium's display-only `--hide-scrollbars` default so
the native scrollbar test can drag an actual visible thumb. It verifies the
measured scrollbar width before dragging and records those measurements.

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
