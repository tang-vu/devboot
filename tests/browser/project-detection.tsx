import { StrictMode, useState, useSyncExternalStore, type DragEvent } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { getLedger, observeDrag, settle, subscribe, syntheticPaths } from './project-detection-bridge';
import './project-detection.css';

function beginSyntheticDrag(event: DragEvent<HTMLDivElement>, file: File | undefined) {
    if (!file) {
        event.preventDefault();
        return;
    }
    // Preserve the browser-selected, backed File. Chromium's native drag
    // transport drops renderer-only Files, even when the drag events are trusted.
    // Only empty, test-owned files with the declared synthetic names are accepted.
    event.dataTransfer.items.add(file);
    event.dataTransfer.effectAllowed = 'copy';
    observeDrag(event.nativeEvent, 'source');
}

function Controls() {
    const entries = useSyncExternalStore(subscribe, getLedger);
    const waiting = entries.filter(entry => entry.status === 'pending');
    const [dragFiles, setDragFiles] = useState<Record<string, File>>({});
    const [fileError, setFileError] = useState('');
    return (
        <aside className="project-detection-controls" aria-label="Synthetic project controls">
            <h1>DevBoot synthetic project detection QA</h1>
            <p>Real App. Synthetic folders and projects only. Drag inputs are empty test-owned files. No native calls or processes.</p>
            <p data-testid="project-detection-denied-count">Denied actions: {entries.filter(entry => entry.kind === 'denied').length}</p>
            <h2>Native drag sources</h2>
            <label htmlFor="synthetic-drag-files">Select empty synthetic drag files</label>
            <input id="synthetic-drag-files" type="file" multiple onChange={event => {
                const files = Array.from(event.currentTarget.files ?? []);
                const allowedNames: string[] = [syntheticPaths.DropA, syntheticPaths.DropB];
                if (files.some(file => file.size !== 0 || !allowedNames.includes(file.name))) {
                    setFileError('Select only empty synthetic-drop-a and synthetic-drop-b test files.');
                    setDragFiles({});
                    return;
                }
                setFileError('');
                setDragFiles(Object.fromEntries(files.map(file => [file.name, file])));
            }} />
            {fileError && <p role="alert">{fileError}</p>}
            <p data-testid="synthetic-drag-ready">Ready: {Object.keys(dragFiles).join(', ') || 'none'}</p>
            {(['DropA', 'DropB'] as const).map(key => (
                <div key={key} draggable={Boolean(dragFiles[syntheticPaths[key]])} className="synthetic-folder" data-testid={`drag-${key}`}
                    onDragStart={event => beginSyntheticDrag(event, dragFiles[syntheticPaths[key]])}
                    onDragEnd={event => observeDrag(event.nativeEvent, 'source')}>
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
        <div className="project-detection-app"
            onDragEnterCapture={event => observeDrag(event.nativeEvent, 'app')}
            onDragOverCapture={event => observeDrag(event.nativeEvent, 'app')}
            onDropCapture={event => observeDrag(event.nativeEvent, 'app')}>
            <App />
        </div>
    </StrictMode>,
);
