export async function invoke<T>(command: string): Promise<T> {
    throw new Error(`Synthetic browser fixture refuses all Tauri calls (${command})`);
}
