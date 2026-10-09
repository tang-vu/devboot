import { StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { getLedger, settle, subscribe } from './project-loading-bridge';
import './project-loading.css';

function Fixture() {
    const entries = useSyncExternalStore(subscribe, getLedger);
    const [mounted, setMounted] = useState(true);
    const [narrow, setNarrow] = useState(false);
    return <>
        <aside className="project-loading-controls" aria-label="Synthetic project loading controls">
            <h1>DevBoot synthetic project loading QA</h1>
            <p>Real App. Deferred in-memory reads only. No files, native picker, startup, or process calls.</p>
            <button type="button" onClick={() => setMounted(value => !value)}>{mounted ? 'Unmount App' : 'Mount App'}</button>
            <button type="button" onClick={() => setNarrow(value => !value)}>{narrow ? 'Widen App' : 'Narrow App'}</button>
            <p data-testid="project-loading-denied-count">Denied actions: {entries.filter(entry => entry.kind === 'denied').length}</p>
            <h2>Pending synthetic reads</h2>
            {entries.filter(entry => entry.status === 'pending').map(entry => <section
                key={entry.id} data-testid="project-loading-pending" data-command={entry.command} data-id={entry.id}>
                <h3>{entry.command} #{entry.id}</h3>
                <button type="button" onClick={() => settle(entry.id, 'resolve')}>Resolve #{entry.id}</button>
                {entry.command === 'get_projects' && <>
                    <button type="button" onClick={() => settle(entry.id, 'empty')}>Empty #{entry.id}</button>
                    <button type="button" onClick={() => settle(entry.id, 'newer')}>Newer #{entry.id}</button>
                    <button type="button" onClick={() => settle(entry.id, 'reject-long')}>Reject long #{entry.id}</button>
                </>}
                {entry.command === 'get_project_log_snapshot' &&
                    <button type="button" onClick={() => settle(entry.id, 'history-warning')}>History warning #{entry.id}</button>}
                <button type="button" onClick={() => settle(entry.id, 'reject')}>Reject #{entry.id}</button>
            </section>)}
            <details>
                <summary>Read and completion ledger</summary>
                <pre data-testid="project-loading-ledger">{JSON.stringify(entries, null, 2)}</pre>
            </details>
        </aside>
        <div className={`project-loading-app${narrow ? ' narrow' : ''}`}>{mounted && <App />}</div>
    </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
