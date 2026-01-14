import { useEffect, useRef } from 'react';
import './Terminal.css';

interface TerminalProps {
    projectName: string;
    logs: string[];
    onClear: () => void;
    onRestart: () => void;
    onStop: () => void;
    isRunning: boolean;
}

export function Terminal({
    projectName,
    logs,
    onClear,
    onRestart,
    onStop,
    isRunning,
}: TerminalProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const formatLog = (log: string) => {
        // Highlight errors in red
        if (log.includes('[ERR]') || log.toLowerCase().includes('error')) {
            return <span className="log-error">{log}</span>;
        }
        // Highlight warnings in yellow
        if (log.toLowerCase().includes('warning') || log.toLowerCase().includes('warn')) {
            return <span className="log-warn">{log}</span>;
        }
        // Highlight success messages in green
        if (log.toLowerCase().includes('success') || log.toLowerCase().includes('started') || log.toLowerCase().includes('connected')) {
            return <span className="log-success">{log}</span>;
        }
        return log;
    };

    return (
        <div className="terminal">
            <div className="terminal-header">
                <div className="terminal-title">
                    <span className="terminal-icon">📟</span>
                    <span>{projectName}</span>
                    <span className={`status-badge ${isRunning ? 'running' : 'stopped'}`}>
                        {isRunning ? '● Running' : '○ Stopped'}
                    </span>
                </div>
                <div className="terminal-actions">
                    {isRunning ? (
                        <button className="term-btn stop" onClick={onStop} title="Stop">
                            ■ Stop
                        </button>
                    ) : (
                        <button className="term-btn start" onClick={onRestart} title="Start">
                            ▶ Start
                        </button>
                    )}
                    <button className="term-btn restart" onClick={onRestart} title="Restart">
                        ↻ Restart
                    </button>
                    <button className="term-btn clear" onClick={onClear} title="Clear logs">
                        🗑 Clear
                    </button>
                </div>
            </div>

            <div className="terminal-body">
                {logs.length === 0 ? (
                    <div className="terminal-empty">
                        <span className="empty-icon">📭</span>
                        <p>No logs yet</p>
                        <p className="empty-hint">Start the project to see output here</p>
                    </div>
                ) : (
                    <div className="log-container">
                        {logs.map((log, index) => (
                            <div key={index} className="log-line">
                                {formatLog(log)}
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
}
