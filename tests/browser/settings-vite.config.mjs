import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const bridge = fileURLToPath(new URL('./settings-bridge.ts', import.meta.url));

export default defineConfig({
    plugins: [
        {
            name: 'isolate-synthetic-settings',
            enforce: 'pre',
            resolveId(source) {
                if (source.startsWith('@tauri-apps/')) {
                    throw new Error(`Unaliased native import forbidden in Settings fixture: ${source}`);
                }
            },
            transform(source, id) {
                // Preserve real App styles while preventing its optional remote font request.
                if (id.split('?')[0].endsWith('/src/App.css')) {
                    return source.replace(/^@import url\('https:\/\/fonts\.googleapis\.com\/[^\n]+\);\r?\n/m, '');
                }
            },
        },
        react(),
    ],
    resolve: {
        alias: [
            { find: /^@tauri-apps\/api\/core$/, replacement: bridge },
            { find: /^@tauri-apps\/api\/event$/, replacement: bridge },
            { find: /^@tauri-apps\/plugin-dialog$/, replacement: bridge },
        ],
    },
    server: { host: '127.0.0.1', port: 4180, strictPort: true, hmr: false },
    build: { rollupOptions: { input: fileURLToPath(new URL('./settings.html', import.meta.url)) } },
});
