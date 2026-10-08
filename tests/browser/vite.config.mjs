import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Isolated fixture: importing the real Terminal cannot call a Tauri process.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@tauri-apps/api/core': fileURLToPath(new URL('./tauri-deny.ts', import.meta.url)),
        },
    },
    server: { host: '127.0.0.1', port: 4179, strictPort: true },
});
