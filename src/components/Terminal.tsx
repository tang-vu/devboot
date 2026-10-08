import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './Terminal.css';

interface TerminalProps {
    projectId: string;
    projectName: string;
    logs: string[];
    onClear: () => void;
    onRestart: () => void;
    onStop: () => void;
    onStart: () => void;
    isRunning: boolean;
}

export function Terminal({
    projectId,
    projectName,
    logs,
    onClear,
    onRestart,
    onStop,
    onStart,
    isRunning,
}: TerminalProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [inputValue, setInputValue] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [inputError, setInputError] = useState<string | null>(null);
    const inputRevisionRef = useRef(0);
    const pendingInputRef = useRef<{ projectId: string; input: string; revision: number } | null>(null);

    // App keys this view by project. A closed view cannot update a later view,
    // including when the same project is selected again before its send finishes.
    useEffect(() => () => {
        pendingInputRef.current = null;
    }, []);

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

    // Export logs as text file
    const handleExportLogs = () => {
        if (logs.length === 0) return;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${projectName.replace(/\s+/g, '_')}_logs_${timestamp}.txt`;
        const content = [
            `DevBoot Logs - ${projectName}`,
            `Exported: ${new Date().toLocaleString()}`,
            `Total lines: ${logs.length}`,
            '='.repeat(50),
            '',
            ...logs
        ].join('\n');

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Handle sending input to the process
    const handleSendInput = async () => {
        if (!inputValue.trim() || !isRunning || pendingInputRef.current) return;

        const request = { projectId, input: inputValue, revision: inputRevisionRef.current };
        // Lock synchronously: repeated events can arrive before React renders.
        pendingInputRef.current = request;
        setIsSending(true);
        setInputError(null);

        try {
            await invoke('send_project_input', {
                projectId: request.projectId,
                input: request.input,
            });
            if (pendingInputRef.current === request && inputRevisionRef.current === request.revision) {
                setInputValue('');
            }
        } catch (error) {
            if (pendingInputRef.current === request) {
                setInputError(`Failed to send input: ${error}`);
            }
        } finally {
            if (pendingInputRef.current === request) {
                pendingInputRef.current = null;
                setIsSending(false);
            }
        }
    };

    // Handle sending interrupt (Ctrl+C) to the process
    const handleSendInterrupt = async () => {
        if (!isRunning) return;
        
        try {
            await invoke('send_project_interrupt', { projectId });
        } catch (error) {
            console.error('Failed to send interrupt:', error);
        }
    };

    // Handle key press in input field
    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Ctrl+C - Send interrupt signal
        if (e.ctrlKey && e.key === 'c' && isRunning) {
            e.preventDefault();
            handleSendInterrupt();
            return;
        }
        
        // Enter - Send input
        if (e.key === 'Enter' && !e.shiftKey) {
            // IME confirmation (including the keyCode 229 fallback) is not a send.
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.repeat) return;
            e.preventDefault();
            handleSendInput();
        }
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
                        <button className="term-btn stop" onClick={onStop} title="Stop (Ctrl+.)">
                            ■ Stop
                        </button>
                    ) : (
                        <button className="term-btn start" onClick={onStart} title="Start (Ctrl+Enter)">
                            ▶ Start
                        </button>
                    )}
                    <button className="term-btn restart" onClick={onRestart} title="Restart (Ctrl+R)">
                        ↻ Restart
                    </button>
                    <button 
                        className="term-btn export" 
                        onClick={handleExportLogs} 
                        title="Export logs"
                        disabled={logs.length === 0}
                    >
                        📥 Export
                    </button>
                    <button className="term-btn clear" onClick={onClear} title="Clear logs (Ctrl+L)">
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

            {/* Terminal Input */}
            <div className="terminal-input-container">
                <span className="input-prompt">&gt;</span>
                <input
                    ref={inputRef}
                    type="text"
                    className="terminal-input"
                    aria-label="Terminal input"
                    aria-describedby={inputError ? 'terminal-input-error' : undefined}
                    value={inputValue}
                    onChange={(e) => {
                        inputRevisionRef.current += 1;
                        setInputValue(e.target.value);
                    }}
                    onKeyDown={handleInputKeyDown}
                    placeholder={isRunning ? "Type command and press Enter..." : "Start the process to send input"}
                    disabled={!isRunning}
                />
                <button 
                    className="input-send-btn"
                    onClick={handleSendInput}
                    disabled={!isRunning || !inputValue.trim() || isSending}
                    title="Send (Enter)"
                >
                    {isSending ? 'Sending...' : 'Send'}
                </button>
            </div>
            {inputError && (
                <div id="terminal-input-error" className="terminal-input-error" role="alert">
                    {inputError} Your text has been kept; try again when ready.
                </div>
            )}

            <div className="terminal-footer">
                <span className="log-count">{logs.length} lines</span>
                <div className="shortcuts-hint">
                    <span>Ctrl+C: Interrupt</span>
                    <span>Ctrl+Enter: Start</span>
                    <span>Ctrl+.: Stop</span>
                    <span>Ctrl+R: Restart</span>
                    <span>Ctrl+L: Clear</span>
                </div>
            </div>
        </div>
    );
}
