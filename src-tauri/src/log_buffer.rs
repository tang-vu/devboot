//! In-memory log ordering. Sequence numbers describe accepted storage order,
//! independently of process launches, wall-clock timestamps, and event delivery.

use std::collections::VecDeque;

use serde::Serialize;

const MAX_LOG_LINES: usize = 1000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LogRecord {
    // Decimal strings preserve all u64 values across JavaScript's number boundary.
    pub seq: String,
    pub log: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogCaptureError {
    SequenceExhausted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LogSnapshot {
    pub session_id: String,
    pub project_id: String,
    pub through_seq: String,
    pub discarded_through: String,
    pub records: Vec<LogRecord>,
    pub capture_error: Option<LogCaptureError>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LogEvent {
    Append {
        session_id: String,
        project_id: String,
        record: LogRecord,
        discarded_through: String,
    },
    Clear {
        snapshot: LogSnapshot,
    },
    Error {
        session_id: String,
        project_id: String,
        error: LogCaptureError,
    },
}

struct StoredRecord {
    seq: u64,
    log: String,
}

impl StoredRecord {
    fn to_record(&self) -> LogRecord {
        LogRecord {
            seq: self.seq.to_string(),
            log: self.log.clone(),
        }
    }
}

#[derive(Default)]
pub struct LogBuffer {
    through_seq: u64,
    discarded_through: u64,
    records: VecDeque<StoredRecord>,
    capture_error: Option<LogCaptureError>,
}

impl LogBuffer {
    fn append(&mut self, log: String) -> Result<LogRecord, LogCaptureError> {
        let seq = self.through_seq.checked_add(1).ok_or_else(|| {
            self.capture_error = Some(LogCaptureError::SequenceExhausted);
            LogCaptureError::SequenceExhausted
        })?;
        self.through_seq = seq;
        if self.records.len() == MAX_LOG_LINES {
            self.discarded_through = self.records.pop_front().unwrap().seq;
        }
        self.records.push_back(StoredRecord { seq, log });
        Ok(self.records.back().unwrap().to_record())
    }

    /// Build an event at the same boundary as storage. A rejected append never
    /// produces a record, and the first rejection explicitly reports lost capture.
    pub fn append_event(
        &mut self,
        session_id: &str,
        project_id: &str,
        log: String,
    ) -> Option<LogEvent> {
        let already_failed = self.capture_error.is_some();
        match self.append(log) {
            Ok(record) => Some(LogEvent::Append {
                session_id: session_id.to_string(),
                project_id: project_id.to_string(),
                record,
                discarded_through: self.discarded_through.to_string(),
            }),
            Err(error) if !already_failed => Some(LogEvent::Error {
                session_id: session_id.to_string(),
                project_id: project_id.to_string(),
                error,
            }),
            Err(_) => None,
        }
    }

    pub fn snapshot(&self, session_id: &str, project_id: &str) -> LogSnapshot {
        LogSnapshot {
            session_id: session_id.to_string(),
            project_id: project_id.to_string(),
            through_seq: self.through_seq.to_string(),
            discarded_through: self.discarded_through.to_string(),
            records: self.records.iter().map(StoredRecord::to_record).collect(),
            capture_error: self.capture_error,
        }
    }

    /// The owner holds its process-map lock across clear and snapshot. Neither
    /// clearing nor a process restart grants permission to reuse a sequence.
    pub fn clear(&mut self, session_id: &str, project_id: &str) -> LogSnapshot {
        self.records.clear();
        self.discarded_through = self.through_seq;
        self.snapshot(session_id, project_id)
    }

    pub fn legacy_logs(&self) -> Vec<String> {
        self.records
            .iter()
            .map(|record| record.log.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identical_lines_have_distinct_ids_and_snapshots_do_not_consume_ids() {
        let mut logs = LogBuffer::default();
        assert_eq!(logs.snapshot("session", "project").through_seq, "0");
        let first = logs.append("same".into()).unwrap();
        let before = logs.snapshot("session", "project");
        let second = logs.append("same".into()).unwrap();
        assert_eq!(first.seq, "1");
        assert_eq!(second.seq, "2");
        assert_eq!(first.log, second.log);
        assert_eq!(before.records.as_slice(), std::slice::from_ref(&first));
        assert_eq!(before.through_seq, "1");
        let after = logs.snapshot("session", "project");
        assert_eq!(after.records, [first, second]);
        assert_eq!(after.through_seq, "2");
        assert_eq!(after.discarded_through, "0");
        assert_eq!(logs.legacy_logs(), ["same", "same"]);
    }

    #[test]
    fn project_and_manager_session_identity_are_part_of_the_protocol() {
        let mut first_project = LogBuffer::default();
        let mut other_project = LogBuffer::default();
        let first = first_project.append_event("session-a", "project-a", "line".into());
        let other = other_project.append_event("session-a", "project-b", "line".into());
        assert_ne!(first, other);
        let mut next_manager = LogBuffer::default();
        let next = next_manager.append_event("session-b", "project-a", "line".into());
        assert_ne!(first, next);
        assert_eq!(
            first_project.snapshot("session-a", "project-a").through_seq,
            "1"
        );
        assert_eq!(
            other_project.snapshot("session-a", "project-b").through_seq,
            "1"
        );
        assert_eq!(
            next_manager.snapshot("session-b", "project-a").through_seq,
            "1"
        );
    }

    #[test]
    fn clear_returns_the_exact_empty_boundary_and_preserves_later_sequence() {
        let mut logs = LogBuffer::default();
        let old = logs.append("before clear".into()).unwrap();
        let before = logs.snapshot("session", "project");
        let cleared = logs.clear("session", "project");
        let later = logs.append("after clear".into()).unwrap();
        assert_eq!(before.records, [old]);
        assert!(cleared.records.is_empty());
        assert_eq!(cleared.through_seq, "1");
        assert_eq!(cleared.discarded_through, "1");
        assert_eq!(later.seq, "2");
        let current = logs.snapshot("session", "project");
        assert_eq!(current.records, [later]);
        assert_eq!(current.through_seq, "2");
        assert_eq!(current.discarded_through, "1");
        assert_eq!(
            logs.clear("session", "project"),
            logs.clear("session", "project")
        );
    }

    #[test]
    fn clearing_an_empty_buffer_does_not_allocate_a_record() {
        let mut logs = LogBuffer::default();
        let cleared = logs.clear("session", "project");
        assert_eq!(cleared.through_seq, "0");
        assert_eq!(cleared.discarded_through, "0");
        assert_eq!(logs.append("first".into()).unwrap().seq, "1");
    }

    #[test]
    fn retention_discards_only_oldest_records_and_reports_its_boundary() {
        let mut logs = LogBuffer::default();
        for index in 1..=1000 {
            logs.append(format!("line {index}")).unwrap();
        }
        assert_eq!(logs.snapshot("session", "project").discarded_through, "0");
        let event = logs
            .append_event("session", "project", "line 1001".into())
            .unwrap();
        assert!(
            matches!(event, LogEvent::Append { discarded_through, .. } if discarded_through == "1")
        );
        for index in 1002..=1200 {
            logs.append(format!("line {index}")).unwrap();
        }
        let snapshot = logs.snapshot("session", "project");
        assert_eq!(snapshot.records.len(), 1000);
        assert_eq!(snapshot.records.first().unwrap().seq, "201");
        assert_eq!(snapshot.records.last().unwrap().seq, "1200");
        assert_eq!(snapshot.through_seq, "1200");
        assert_eq!(snapshot.discarded_through, "200");
        let cleared = logs.clear("session", "project");
        assert_eq!(cleared.discarded_through, "1200");
        assert_eq!(logs.append("later run".into()).unwrap().seq, "1201");
        assert_eq!(
            logs.snapshot("session", "project").discarded_through,
            "1200"
        );
    }

    #[test]
    fn later_launches_keep_the_same_buffer_order() {
        let mut logs = LogBuffer::default();
        for line in [
            "first launch",
            "crashed",
            "restart",
            "stopped",
            "manual start",
        ] {
            logs.append(line.into()).unwrap();
        }
        let snapshot = logs.snapshot("session", "project");
        assert_eq!(snapshot.through_seq, "5");
        assert_eq!(
            snapshot
                .records
                .iter()
                .map(|record| record.seq.as_str())
                .collect::<Vec<_>>(),
            ["1", "2", "3", "4", "5"]
        );
        logs.clear("session", "project");
        assert_eq!(logs.append("another launch".into()).unwrap().seq, "6");
    }

    #[test]
    fn wire_values_preserve_u64_precision() {
        let mut logs = LogBuffer {
            through_seq: 9_007_199_254_740_992,
            discarded_through: 9_007_199_254_740_992,
            ..LogBuffer::default()
        };
        let event = logs
            .append_event("session", "project", "line".into())
            .unwrap();
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            json!({
                "kind": "append", "session_id": "session", "project_id": "project",
                "record": {"seq": "9007199254740993", "log": "line"},
                "discarded_through": "9007199254740992"
            })
        );
        let snapshot = serde_json::to_value(logs.snapshot("session", "project")).unwrap();
        assert_eq!(snapshot["through_seq"], "9007199254740993");
        assert_eq!(snapshot["discarded_through"], "9007199254740992");
        assert_eq!(snapshot["capture_error"], serde_json::Value::Null);
    }

    #[test]
    fn exhaustion_never_wraps_or_claims_rejected_output_as_captured() {
        let mut logs = LogBuffer {
            through_seq: u64::MAX - 1,
            discarded_through: u64::MAX - 1,
            ..LogBuffer::default()
        };
        let last = logs.append("last accepted".into()).unwrap();
        assert_eq!(last.seq, "18446744073709551615");
        assert_eq!(logs.snapshot("session", "project").capture_error, None);
        let error = logs
            .append_event("session", "project", "rejected".into())
            .unwrap();
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({
                "kind": "error", "session_id": "session", "project_id": "project",
                "error": "sequence_exhausted"
            })
        );
        assert!(logs
            .append_event("session", "project", "also rejected".into())
            .is_none());
        let snapshot = logs.snapshot("session", "project");
        assert_eq!(snapshot.through_seq, u64::MAX.to_string());
        assert_eq!(snapshot.discarded_through, (u64::MAX - 1).to_string());
        assert_eq!(snapshot.records, [last]);
        assert_eq!(
            snapshot.capture_error,
            Some(LogCaptureError::SequenceExhausted)
        );
        let cleared = logs.clear("session", "project");
        assert!(cleared.records.is_empty());
        assert_eq!(cleared.through_seq, u64::MAX.to_string());
        assert_eq!(cleared.discarded_through, u64::MAX.to_string());
        assert_eq!(
            cleared.capture_error,
            Some(LogCaptureError::SequenceExhausted)
        );
        assert_eq!(
            logs.append("still rejected".into()),
            Err(LogCaptureError::SequenceExhausted)
        );
        assert!(logs.legacy_logs().is_empty());
    }

    #[test]
    fn clear_wire_event_contains_the_atomic_snapshot() {
        let mut logs = LogBuffer::default();
        logs.append("line".into()).unwrap();
        let event = LogEvent::Clear {
            snapshot: logs.clear("session", "project"),
        };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            json!({
                "kind": "clear", "snapshot": {
                    "session_id": "session", "project_id": "project",
                    "through_seq": "1", "discarded_through": "1", "records": [],
                    "capture_error": null
                }
            })
        );
    }
}
