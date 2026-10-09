import { StrictMode, useSyncExternalStore, type DragEvent } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { getLedger, settle, subscribe, syntheticPaths } from './project-detection-bridge';
import './project-detection.css';

function beginSyntheticDrag(event: DragEvent<HTMLDivElement>, path: string) {
    // The native drag gesture creates its own DataTransfer; no test dispatches
    // app events or writes application state. This File contains no disk data.
    event.dataTransfer.items.add(new File([], path, { type: 'application/x-devboot-synthetic-folder' }));
    event.dataTransfer.effectAllowed = 'copy';
}

function Controls() {
    const entries = useSyncExternalStore(subscribe, getLedger);
    const waiting = entries.filter(entry => entry.status === 'pending');
    return (
        <aside className="project-detection-controls" aria-label="Synthetic project controls">
            <h1>DevBoot synthetic project detection QA</h1>
            <p>Real App. In-memory folders and projects only. No native calls or processes.</p>
            <p data-testid="project-detection-denied-count">Denied actions: {entries.filter(entry => entry.kind === 'denied').length}</p>
            <h2>Native drag sources</h2>
            {(['DropA', 'DropB'] as const).map(key => (
                <div key={key} draggable className="synthetic-folder" data-testid={`drag-${key}`}
                    onDragStart={event => beginSyntheticDrag(event, syntheticPaths[key])}>
                    Drag synthetic folder {key}
                </div>
            ))}
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
