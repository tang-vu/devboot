export function createSyntheticDragFiles(directory: string): Promise<{
    paths: string[];
    cleanup: () => Promise<void>;
}>;
