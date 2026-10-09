import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { getLedger, settle, subscribe, syntheticPaths } from './project-detection-bridge';
import './project-detection.css';

function Controls() {
    const entries = useSyncExternalStore(subscribe, getLedger);
    const waiting = entries.filter(entry => entry.status === 'pending');
    return (
        <aside className="project-detection-controls" aria-label="Synthetic project controls">
            <h1>DevBoot synthetic project detection QA</h1>
            <p>Real App. Synthetic folder paths and projects remain in memory. No native calls, file access, or processes.</p>
            <p data-testid="project-detection-denied-count">Denied actions: {entries.filter(entry => entry.kind === 'denied').length}</p>
            <h2>Pending synthetic operations</h2>
            {waiting.length === 0 && <p>No pending operations</p>}
            {waiting.map(entry => (
                <section key={entry.id} data-testid="project-detection-pending" data-command={entry.command} data-id={entry.id}>
                    <h3>{entry.command} #{entry.id}</h3>
                    <p>{JSON.stringify(entry.args)}</p>
                    {entry.kind === 'picker' ? <>
                        {(['A', 'B', 'Empty'] as const).map(key => (
                            <button key={key} type="button" onClick={() => settle(entry.id, 'resolve', syntheticPaths[key])}>
                                Choose {key} #{entry.id}
                            </button>
                        ))}
                        <button type="button" onClick={() => settle(entry.id, 'cancel')}>Cancel picker #{entry.id}</button>
                    </> : <button type="button" onClick={() => settle(entry.id, 'resolve')}>Resolve #{entry.id}</button>}
                    <button type="button" onClick={() => settle(entry.id, 'reject')}>Reject #{entry.id}</button>
                </section>
            ))}
            <details>
                <summary>Retained command and payload ledger</summary>
                <pre data-testid="project-detection-ledger">{JSON.stringify(entries, null, 2)}</pre>
            </details>
        </aside>
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Controls />
        <div className="project-detection-app"><App /></div>
    </StrictMode>,
);
