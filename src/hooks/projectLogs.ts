import type { LogCaptureError, LogEvent, LogRecord, LogSnapshot } from '../types';

const MAX_LOG_LINES = 1000;
const MAX_PENDING_SESSIONS = 2;

interface StreamState {
    records: LogRecord[];
    coveredThrough: bigint;
    discardedThrough: bigint;
    captureError: LogCaptureError | null;
}

export interface ProjectLogs extends StreamState {
    sessionId: string | null;
    // Events cannot select the current backend session. Keep their bounded
    // history until a current, owned snapshot identifies the session.
    pending: ReadonlyMap<string, StreamState>;
    retiredSessions: ReadonlySet<string>;
    pendingOverflow: boolean;
    needsSnapshot: boolean;
}

const emptyStream = (): StreamState => ({
    records: [], coveredThrough: 0n, discardedThrough: 0n, captureError: null,
});

export const emptyProjectLogs = (): ProjectLogs => ({
    ...emptyStream(), sessionId: null, pending: new Map(), retiredSessions: new Set(),
    pendingOverflow: false, needsSnapshot: false,
});

function retain(stream: StreamState): StreamState {
    const unique = new Map(stream.records
        .filter(record => BigInt(record.seq) > stream.discardedThrough)
        .map(record => [record.seq, record]));
    const records = [...unique.values()].sort((a, b) => BigInt(a.seq) < BigInt(b.seq) ? -1 : 1);
    const removed = records.splice(0, Math.max(0, records.length - MAX_LOG_LINES));
    return {
        ...stream, records,
        discardedThrough: removed.length ? BigInt(removed[removed.length - 1].seq) : stream.discardedThrough,
    };
}

function mergeSnapshot(stream: StreamState, snapshot: LogSnapshot): StreamState {
    const through = BigInt(snapshot.through_seq);
    const discarded = BigInt(snapshot.discarded_through);
    return retain({
        records: through >= stream.coveredThrough
            ? [...snapshot.records, ...stream.records.filter(record => BigInt(record.seq) > through)]
            : stream.records,
        coveredThrough: through > stream.coveredThrough ? through : stream.coveredThrough,
        discardedThrough: discarded > stream.discardedThrough ? discarded : stream.discardedThrough,
        captureError: stream.captureError ?? snapshot.capture_error,
    });
}

function mergeEvent(stream: StreamState, event: LogEvent): StreamState {
    if (event.kind === 'clear') return mergeSnapshot(stream, event.snapshot);
    if (event.kind === 'error') return { ...stream, captureError: event.error };
    const discarded = BigInt(event.discarded_through);
    let discardedThrough = discarded > stream.discardedThrough ? discarded : stream.discardedThrough;
    let records = discardedThrough > stream.discardedThrough
        ? stream.records.filter(record => BigInt(record.seq) > discardedThrough) : stream.records;
    const seq = BigInt(event.record.seq);
    if (seq <= stream.coveredThrough || seq <= discardedThrough) return { ...stream, records, discardedThrough };

    // Records are already ordered. Ordinary delivery appends directly; delayed
    // records use binary insertion instead of sorting the entire history again.
    let index = records.length;
    if (index && seq <= BigInt(records[index - 1].seq)) {
        let low = 0;
        let high = index;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (BigInt(records[middle].seq) < seq) low = middle + 1;
            else high = middle;
        }
        index = low;
        if (records[index]?.seq === event.record.seq) return { ...stream, records, discardedThrough };
    }
    records = [...records.slice(0, index), event.record, ...records.slice(index)];
    if (records.length > MAX_LOG_LINES) {
        discardedThrough = BigInt(records[0].seq);
        records = records.slice(1);
    }
    return { ...stream, records, discardedThrough };
}

export function receiveLogEvent(state: ProjectLogs, event: LogEvent): ProjectLogs {
    const session = event.kind === 'clear' ? event.snapshot.session_id : event.session_id;
    if (state.retiredSessions.has(session)) return state;
    if (state.sessionId === session) return { ...state, ...mergeEvent(state, event) };
    const pending = new Map(state.pending);
    let pendingOverflow = state.pendingOverflow;
    if (!pending.has(session) && pending.size === MAX_PENDING_SESSIONS) {
        pending.delete(pending.keys().next().value!);
        pendingOverflow = true;
    }
    pending.set(session, mergeEvent(pending.get(session) ?? emptyStream(), event));
    return { ...state, pending, pendingOverflow };
}

// Only a snapshot response whose request still belongs to the current hook
// lifetime/refresh may call this function. Clear replies are events, not a new
// session authority. A retired session can never become current again.
export function receiveLogSnapshot(state: ProjectLogs, snapshot: LogSnapshot): ProjectLogs {
    if (state.retiredSessions.has(snapshot.session_id)) return state;
    if (state.sessionId === snapshot.session_id) return { ...state, ...mergeSnapshot(state, snapshot), needsSnapshot: false };
    const retiredSessions = new Set(state.retiredSessions);
    if (state.sessionId) retiredSessions.add(state.sessionId);
    return {
        ...mergeSnapshot(state.pending.get(snapshot.session_id) ?? emptyStream(), snapshot),
        sessionId: snapshot.session_id, retiredSessions, pending: new Map(),
        pendingOverflow: false, needsSnapshot: state.pendingOverflow,
    };
}
