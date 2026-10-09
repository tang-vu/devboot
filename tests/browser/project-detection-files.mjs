import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Node-only fixture preparation. This module is never imported by the browser.
// Fail if the dedicated directory already exists; never overwrite input files.
export async function createSyntheticDragFiles(directory) {
    await mkdir(directory);
    const paths = ['synthetic-drop-a', 'synthetic-drop-b'].map(name => join(directory, name));
    const cleanup = () => rm(directory, { recursive: true, force: true });
    try {
        await Promise.all(paths.map(path => writeFile(path, '', { flag: 'wx' })));
        return { paths, cleanup };
    } catch (error) {
        await cleanup();
        throw error;
    }
}
