import { describe, expect, it } from 'vitest';
import { emptyProjectLogs, receiveLogEvent, receiveLogSnapshot } from '../src/hooks/projectLogs';
import type { ProjectLogs } from '../src/hooks/projectLogs';
import type { LogEvent } from '../src/types';
import { appendLog, logSnapshot } from './log-fixtures';

const pid = 'synthetic-reducer';
const snapshot = (logs: string[] = [], overrides = {}) => logSnapshot(pid, logs, overrides);
const append = (seq: string, log = `line ${seq}`, session = 'synthetic-session-A', discarded = '0') =>
    appendLog(pid, seq, log, session, discarded);
const visible = (state: ProjectLogs) => state.records.map(record => record.log);
const bound = () => receiveLogSnapshot(emptyProjectLogs(), snapshot());

describe('sequenced project log reconciliation', () => {
    it('buffers live records until an owned snapshot identifies the session', () => {
        let state = receiveLogEvent(emptyProjectLogs(), append('2', 'during snapshot'));
        expect(state.sessionId).toBeNull();
        expect(visible(state)).toEqual([]);
        state = receiveLogSnapshot(state, snapshot(['initial history']));
        expect(visible(state)).toEqual(['initial history', 'during snapshot']);
    });

    it.each(['event first', 'snapshot first'])(
        'shows snapshot/event overlap exactly once (%s)', order => {
            let state = emptyProjectLogs();
            const record = append('2', 'overlapping line');
            const history = snapshot(['first line', 'overlapping line']);
            if (order === 'event first') state = receiveLogEvent(state, record);
            state = receiveLogSnapshot(state, history);
            state = receiveLogEvent(state, record);
            state = receiveLogEvent(state, record);
            expect(visible(state)).toEqual(['first line', 'overlapping line']);
            expect(state.records.map(record => record.seq)).toEqual(['1', '2']);
        },
    );

    it('orders shuffled records and deduplicates delivery by sequence without dropping identical text', () => {
        let state = bound();
        for (const seq of ['4', '2', '3', '2', '1', '4']) {
            state = receiveLogEvent(state, append(seq, 'identical text'));
        }
        expect(state.records.map(record => record.seq)).toEqual(['1', '2', '3', '4']);
        expect(visible(state)).toEqual(Array(4).fill('identical text'));
    });

    it('merges a snapshot with later events and ignores an older snapshot after newer coverage', () => {
        let state = receiveLogEvent(bound(), append('4', 'live fourth'));
        state = receiveLogSnapshot(state, snapshot(['one', 'two', 'three']));
        state = receiveLogSnapshot(state, snapshot(['one']));
        expect(visible(state)).toEqual(['one', 'two', 'three', 'live fourth']);
    });

    it.each([
        ['snapshot', 'clear', 'append'], ['snapshot', 'append', 'clear'],
        ['clear', 'snapshot', 'append'], ['clear', 'append', 'snapshot'],
        ['append', 'snapshot', 'clear'], ['append', 'clear', 'snapshot'],
    ])('reconciles old snapshot, clear, and post-clear append in order %s, %s, %s', (...order) => {
        let state = emptyProjectLogs();
        const clear: LogEvent = { kind: 'clear', snapshot: snapshot([], {
            through_seq: '2', discarded_through: '2',
        }) };
        for (const action of order) {
            if (action === 'snapshot') state = receiveLogSnapshot(state, snapshot(['old one', 'old two']));
            if (action === 'clear') state = receiveLogEvent(state, clear);
            if (action === 'append') state = receiveLogEvent(state, append('3', 'after clear'));
        }
        state = receiveLogEvent(state, append('1', 'ancient callback'));
        state = receiveLogEvent(state, clear); // Broadcast and command response may both deliver the clear.
        expect(visible(state)).toEqual(['after clear']);
        expect(state.records[0].seq).toBe('3');
    });

    it('applies successive clears monotonically when their replies arrive in reverse order', () => {
        let state = receiveLogSnapshot(emptyProjectLogs(), snapshot(['old one', 'old two']));
        state = receiveLogEvent(state, append('5', 'after both clears'));
        for (const seq of ['4', '2']) {
            state = receiveLogEvent(state, { kind: 'clear', snapshot: snapshot([], {
                through_seq: seq, discarded_through: seq,
            }) });
        }
        state = receiveLogSnapshot(state, snapshot(['old one', 'old two', 'old three']));
        expect(visible(state)).toEqual(['after both clears']);
    });

    it('retains the newest 1000 live records and does not revive an ancient late event', () => {
        let state = bound();
        for (let seq = 1; seq <= 1002; seq++) state = receiveLogEvent(state, append(String(seq)));
        expect(state.records).toHaveLength(1000);
        expect(state.records[0].seq).toBe('3');
        expect(state.records[999].seq).toBe('1002');
        state = receiveLogEvent(state, append('1', 'late discarded record'));
        state = receiveLogSnapshot(state, snapshot(['line 1', 'line 2'], { through_seq: '2' }));
        expect(state.records).toHaveLength(1000);
        expect(state.records[0].seq).toBe('3');
        expect(visible(state)).not.toContain('late discarded record');
    });

    it('applies snapshot retention and an append discard watermark to missing or delayed records', () => {
        const records = Array.from({ length: 1004 }, (_, index) => ({ seq: String(index + 1), log: `line ${index + 1}` }));
        let state = receiveLogSnapshot(emptyProjectLogs(), snapshot([], { records, through_seq: '1004' }));
        expect(state.records).toHaveLength(1000);
        expect(state.records[0].seq).toBe('5');
        state = receiveLogEvent(state, append('1007', 'newest', 'synthetic-session-A', '7'));
        state = receiveLogEvent(state, append('6', 'late retained by backend earlier'));
        expect(state.records[0].seq).toBe('8');
        expect(visible(state)).not.toContain('late retained by backend earlier');
        expect(state.records[state.records.length - 1]).toEqual({ seq: '1007', log: 'newest' });
    });

    it('compares decimal sequences precisely beyond Number.MAX_SAFE_INTEGER', () => {
        let state = bound();
        for (const seq of ['9007199254740995', '9007199254740993', '9007199254740994', '9007199254740993']) {
            state = receiveLogEvent(state, append(seq));
        }
        expect(state.records.map(record => record.seq)).toEqual([
            '9007199254740993', '9007199254740994', '9007199254740995',
        ]);
        state = receiveLogEvent(state, { kind: 'clear', snapshot: snapshot([], {
            through_seq: '9007199254740994', discarded_through: '9007199254740994',
        }) });
        expect(state.records.map(record => record.seq)).toEqual(['9007199254740995']);
    });

    it('requires snapshot authority for a new session, including an empty replacement session', () => {
        let state = receiveLogSnapshot(emptyProjectLogs(), snapshot(['old A history']));
        state = receiveLogEvent(state, append('1', 'B live', 'synthetic-session-B'));
        expect(visible(state)).toEqual(['old A history']);
        state = receiveLogSnapshot(state, snapshot([], { session_id: 'synthetic-session-B' }));
        expect(visible(state)).toEqual(['B live']);
        state = receiveLogEvent(state, append('2', 'stale A callback'));
        state = receiveLogSnapshot(state, snapshot(['old A history', 'late A history']));
        expect(state.sessionId).toBe('synthetic-session-B');
        expect(visible(state)).toEqual(['B live']);
    });

    it('keeps an empty B current after A to B to stale A events, clears, errors, and snapshots', () => {
        let state = receiveLogSnapshot(emptyProjectLogs(), snapshot(['old A history']));
        state = receiveLogSnapshot(state, snapshot([], { session_id: 'synthetic-session-B' }));
        state = receiveLogEvent(state, append('2', 'stale A callback'));
        state = receiveLogEvent(state, { kind: 'clear', snapshot: snapshot([], { through_seq: '2', discarded_through: '2' }) });
        state = receiveLogEvent(state, { kind: 'error', project_id: pid, session_id: 'synthetic-session-A', error: 'sequence_exhausted' });
        state = receiveLogSnapshot(state, snapshot(['old A history', 'late A history']));
        expect(state.sessionId).toBe('synthetic-session-B');
        expect(state.records).toEqual([]);
        expect(state.captureError).toBeNull();
    });

    it('never treats a clear reply from an unknown session as session authority', () => {
        let state = receiveLogSnapshot(emptyProjectLogs(), snapshot(['A remains current']));
        state = receiveLogEvent(state, { kind: 'clear', snapshot: snapshot([], {
            session_id: 'synthetic-session-B', through_seq: '7', discarded_through: '7',
        }) });
        expect(state.sessionId).toBe('synthetic-session-A');
        expect(visible(state)).toEqual(['A remains current']);
        state = receiveLogSnapshot(state, snapshot([], { session_id: 'synthetic-session-B' }));
        state = receiveLogEvent(state, append('6', 'pre-clear B callback', 'synthetic-session-B'));
        state = receiveLogEvent(state, append('8', 'post-clear B callback', 'synthetic-session-B'));
        expect(visible(state)).toEqual(['post-clear B callback']);
    });

    it.each(['event', 'snapshot'])('preserves sequence exhaustion reported by %s through clear', source => {
        let state = source === 'snapshot'
            ? receiveLogSnapshot(emptyProjectLogs(), snapshot(['last line'], { capture_error: 'sequence_exhausted' }))
            : receiveLogEvent(emptyProjectLogs(), { kind: 'error', session_id: 'synthetic-session-A', project_id: pid, error: 'sequence_exhausted' });
        if (source === 'event') {
            expect(state.captureError).toBeNull();
            state = receiveLogSnapshot(state, snapshot(['last line']));
        }
        expect(state.captureError).toBe('sequence_exhausted');
        state = receiveLogEvent(state, { kind: 'clear', snapshot: snapshot([], { through_seq: '1', discarded_through: '1' }) });
        expect(visible(state)).toEqual([]);
        expect(state.captureError).toBe('sequence_exhausted');
        state = receiveLogSnapshot(state, snapshot([], { session_id: 'synthetic-session-B' }));
        expect(state.captureError).toBeNull();
    });
});
