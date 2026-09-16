import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy: { '/ws': { target: 'ws://127.0.0.1:3000', ws: true }, '/api': 'http://127.0.0.1:3000' } }, test: { include: ['server/**/*.test.ts', 'shared/**/*.test.ts'] } });
