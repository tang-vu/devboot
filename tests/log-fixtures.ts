import type { LogEvent, LogSnapshot } from '../src/types';

export function logSnapshot(
    projectId: string,
    logs: string[] = [],
    overrides: Partial<LogSnapshot> = {},
): LogSnapshot {
    return {
        session_id: 'synthetic-session-A', project_id: projectId,
        through_seq: String(logs.length), discarded_through: '0',
        records: logs.map((log, index) => ({ seq: String(index + 1), log })),
        capture_error: null, ...overrides,
    };
}

export function appendLog(
    projectId: string, seq: string, log: string,
    sessionId = 'synthetic-session-A', discardedThrough = '0',
): LogEvent {
    return {
        kind: 'append', session_id: sessionId, project_id: projectId,
        record: { seq, log }, discarded_through: discardedThrough,
    };
}
