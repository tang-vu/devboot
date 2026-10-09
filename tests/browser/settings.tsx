import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { getLedger, settle, subscribe } from './settings-bridge';
import './settings.css';

function Controls() {
    const entries = useSyncExternalStore(subscribe, getLedger);
    const waiting = entries.filter(entry => entry.status === 'pending');
    const denied = entries.filter(entry => entry.kind === 'denied');
    return (
        <aside className="settings-fixture-controls" aria-label="Synthetic Settings controls">
            <h1>DevBoot synthetic Settings QA</h1>
            <p>Real App and Settings. Empty projects. Every operation stays in memory.</p>
            <p data-testid="settings-denied-count">Denied actions: {denied.length}</p>
            <h2>Pending synthetic operations</h2>
            {waiting.length === 0 && <p>No pending operations</p>}
            {waiting.map(entry => (
                <section key={entry.id} data-testid="settings-pending" data-command={entry.command} data-id={entry.id}>
                    <h3>{entry.command} #{entry.id}</h3>
                    <button type="button" onClick={() => settle(entry.id, 'resolve')}>Resolve {entry.command} #{entry.id}</button>
                    <button type="button" onClick={() => settle(entry.id, 'reject')}>Reject {entry.command} #{entry.id}</button>
                </section>
            ))}
            <details>
                <summary>Retained command and payload ledger</summary>
                <pre data-testid="settings-ledger">{JSON.stringify(entries, null, 2)}</pre>
            </details>
        </aside>
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Controls />
        <div className="settings-fixture-app"><App /></div>
    </StrictMode>,
);
