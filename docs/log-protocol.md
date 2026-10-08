# Log snapshots and live events

DevBoot keeps the last 1,000 accepted log records per project in memory. History
continues across stop, manual start, and crash restart. It disappears when the
app exits. This protocol does not change project configuration or persist logs.

## Identity and boundaries

A record is identified by `(session_id, project_id, seq)`. The process manager
allocates a session UUID once. Each project's `u64` sequence advances under the
process-map lock and never resets on restart or clear. All accepted sources use
that path: stdout, stderr, echoed input, interrupts, and monitor diagnostics.
Sequence numbers describe storage acceptance order, not when a child produced
the text. Two identical strings are two records if their sequence numbers differ.

The new `get_project_log_snapshot` command returns:

- `session_id` and `project_id`
- `through_seq`: the last accepted sequence at the snapshot boundary
- `discarded_through`: the prefix removed by retention or clear
- `records`: the retained `{ seq, log }` records
- `capture_error`: `null` or `sequence_exhausted`

All sequence fields are decimal strings. JavaScript uses `BigInt` internally;
JSON numbers cannot represent every `u64` value exactly. Sequence increment is
checked. After exhaustion, further lines are rejected, an error event is emitted
once, and snapshots retain the error until a new app session. The terminal shows
that capture has stopped. Clear does not reset the error or reuse IDs.

`process-log-v2` carries tagged `append`, `clear`, and `error` events. Append
includes the accepted record and discard boundary. Clear includes an empty
snapshot. `clear_project_log_snapshot` returns the same atomic clear boundary.
Output accepted after that boundary survives even if it arrives before the
clear command's response. Previously produced output still buffered in a reader
may be accepted after clear and remain visible.

## Frontend reconciliation

The log listener is established before snapshot reads begin. Project and status
reads do not wait for that listener. Registration failure releases owned
listeners, allows fallback snapshots, and displays that live updates are
unavailable. Obsolete hook lifetimes and refreshes cannot publish responses.

Only a current, owned snapshot can select the backend session. Events and clear
replies cannot change it. Retired sessions are ignored for the hook lifetime.
Before selection, events are buffered in at most two unknown-session histories,
each capped at 1,000 records. If a bucket is evicted, session selection triggers
one fresh snapshot to recover the missed interval while that session's new
events merge directly. A failed recovery displays an incomplete-history notice;
it does not poll.

A snapshot supplies the retained prefix through its boundary. The frontend
preserves received records newer than that boundary, ignores overlapping event
identities, and accepts unseen events arriving out of order. Discard boundaries
only advance, preventing old events/snapshots from restoring cleared or evicted
records. The displayed records remain sorted by sequence and capped at 1,000.

After successful deletion, the frontend retires that project ID: callbacks and
pending reads cannot recreate its logs or restore it through an old project
list. This does not promise backend erasure. The existing backend still retains
the stopped ProcessInfo until app exit.

Failed snapshot reads show a per-project notice. Until a session is identified,
live events stay buffered rather than selecting the session themselves. The
terminal's **Reload logs** action starts a fresh owned read; stale failures cannot
replace a newer successful result.

## Compatibility and limits

The legacy `get_project_logs` command still returns `string[]` and
`clear_project_logs` still returns no value. Legacy clear also publishes the v2
boundary. The six existing `process-log` emission sites keep their string
payloads. Monitor diagnostics are added to v2 only. Updated frontends subscribe
to v2 alone, avoiding double consumption. Terminal display and export still use
strings projected from the reconciled records.

This is reconciliation within retained history, not reliable event transport.
Emission failures and disconnected listeners can still miss updates; a later
snapshot recovers only records still retained. The cap bounds record count,
not the bytes in a line or the number of backend project entries. Existing reader
threads may drain across process restarts: no per-run isolation, reader flushing,
process-control changes, or durable history are introduced.
