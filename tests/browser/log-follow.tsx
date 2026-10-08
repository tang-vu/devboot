import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '../../src/components/Terminal';
import type { LogRecord } from '../../src/types';
import './log-follow.css';

const CAP = 1000;
const longLine = 'wrapped geometry marker: alpha beta gamma delta epsilon zeta eta theta '.repeat(12);
type Project = { records: LogRecord[]; next: number; session: string; error: string | null; running: boolean };

function seed(name: string): Project {
    return {
        records: Array.from({ length: 180 }, (_, index) => ({
            seq: String((index + 1) * 2),
            log: index % 9 === 0 ? `${name} row ${index + 1}: ${longLine}` : `${name} row ${index + 1}: synthetic output`,
        })),
        next: 362, session: `fixture-${name}-1`, error: null, running: true,
    };
}

function Fixture() {
    const [projects, setProjects] = useState<Record<string, Project>>(() => ({ alpha: seed('alpha'), beta: seed('beta') }));
    const [selected, setSelected] = useState('alpha');
    const [opened, setOpened] = useState(true);
    const [generation, setGeneration] = useState(0);
    const [streaming, setStreaming] = useState(false);
    const [narrow, setNarrow] = useState(false);
    const [short, setShort] = useState(false);
    const project = projects[selected];

    function update(change: (previous: Project) => Project) {
        setProjects(previous => ({ ...previous, [selected]: change(previous[selected]) }));
    }

    function append(count: number, kind: 'normal' | 'repeat' | 'wrapped' = 'normal') {
        update(previous => ({
            ...previous,
            records: [...previous.records, ...Array.from({ length: count }, (_, index) => ({
                seq: String(previous.next + index * 2),
                log: kind === 'repeat' ? 'identical repeated message' : kind === 'wrapped' ? longLine : `${selected} fresh ${previous.next + index * 2}: synthetic output`,
            }))].slice(-CAP),
            next: previous.next + count * 2,
        }));
    }

    useEffect(() => {
        if (!streaming) return;
        const timer = window.setInterval(() => {
            setProjects(previous => {
                const value = previous[selected];
                return { ...previous, [selected]: {
                    ...value,
                    records: [...value.records, { seq: String(value.next), log: `${selected} sustained ${value.next}: synthetic output` }].slice(-CAP),
                    next: value.next + 2,
                } };
            });
        }, 60);
        return () => window.clearInterval(timer);
    }, [streaming, selected]);

    function reset() {
        setStreaming(false);
        setProjects({ alpha: seed('alpha'), beta: seed('beta') });
        setSelected('alpha'); setOpened(true); setGeneration(value => value + 1);
        setNarrow(false); setShort(false);
    }

    function reload() {
        update(previous => ({ ...previous, error: null, records: [...previous.records] }));
    }

    return <main className="fixture">
        <header className="fixture-header">
            <h1>DevBoot synthetic log-follow QA</h1>
            <p>Real Terminal, synthetic records only. Every Tauri command is denied. No project or OS process is controlled.</p>
            <div className="fixture-controls" aria-label="Synthetic fixture controls">
                <button onClick={reset}>Reset fixture</button>
                <button onClick={() => append(1)}>Append one</button>
                <button onClick={() => append(20, 'repeat')}>Append 20 identical</button>
                <button onClick={() => append(3, 'wrapped')}>Append 3 wrapped</button>
                <button onClick={() => append(300)}>Append 300</button>
                <button onClick={() => {
                    const other = selected === 'alpha' ? 'beta' : 'alpha';
                    setProjects(previous => {
                        const value = previous[other];
                        return { ...previous, [other]: { ...value,
                            records: [...value.records, { seq: String(value.next), log: `${other} unrelated update` }].slice(-CAP),
                            next: value.next + 2,
                        } };
                    });
                }}>Append other project</button>
                <button onClick={() => append(1000)}>Evict all old records</button>
                <button onClick={() => setStreaming(value => !value)}>{streaming ? 'Stop sustained output' : 'Start sustained output'}</button>
                <button onClick={() => update(previous => {
                    const seq = String(Number(previous.records[0]?.seq ?? 0) + 1);
                    return { ...previous, records: [...previous.records.filter(record => record.seq !== seq), { seq, log: `late ${seq}: ${longLine}` }].sort((a, b) => Number(a.seq) - Number(b.seq)).slice(-CAP) };
                })}>Insert late record near start</button>
                <button onClick={() => update(previous => ({ ...previous, error: previous.error ? null : 'Synthetic log subscription failed; reload is available.' }))}>Toggle log error</button>
                <button onClick={reload}>Reload synthetic snapshot</button>
                <button onClick={() => update(previous => ({ ...seed(selected), session: `${previous.session}-replacement` }))}>Replace backend session</button>
                <button onClick={() => { setStreaming(false); setSelected(value => value === 'alpha' ? 'beta' : 'alpha'); setOpened(true); }}>Switch project</button>
                <button onClick={() => { setStreaming(false); setOpened(value => !value); }}>{opened ? 'Close terminal view' : 'Reopen terminal view'}</button>
                <button onClick={() => setNarrow(value => !value)}>{narrow ? 'Widen view' : 'Narrow view'}</button>
                <button onClick={() => setShort(value => !value)}>{short ? 'Taller view' : 'Shorter view'}</button>
            </div>
            <output className="fixture-summary">Project: {selected}; session: {project.session}; records: {project.records.length}; cap: {CAP}; sustained: {streaming ? 'on' : 'off'}; other records: {projects[selected === 'alpha' ? 'beta' : 'alpha'].records.length}</output>
        </header>
        <section className={`fixture-terminal ${narrow ? 'narrow' : ''} ${short ? 'short' : ''}`} aria-label="Synthetic terminal host">
            {opened ? <Terminal
                key={`${selected}-${generation}`}
                projectId={`fixture-${selected}`}
                projectName={`Synthetic ${selected}`}
                records={project.records}
                sessionId={project.session}
                logError={project.error}
                onReloadLogs={reload}
                onClear={() => update(previous => ({ ...previous, records: [] }))}
                onStart={() => update(previous => ({ ...previous, running: true }))}
                onStop={() => update(previous => ({ ...previous, running: false }))}
                onRestart={() => update(previous => ({ ...previous, running: true }))}
                isRunning={project.running}
            /> : <p className="fixture-closed">Synthetic terminal view closed</p>}
        </section>
    </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
