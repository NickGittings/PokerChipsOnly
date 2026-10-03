import { networkInterfaces } from 'node:os';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { joinUrlCandidates } from './server/joinUrls';
import { parseOrigin } from './shared/origin';
// `vite build --mode debug` bakes this laptop's game-server addresses (plus the iOS Simulator/Android emulator aliases) into the pairing screen's debug button; any other build defines null and the button compiles out.
const debugTables = () => { const override = process.env.DEBUG_SERVER && parseOrigin(process.env.DEBUG_SERVER); return override ? [override] : [...new Set([...joinUrlCandidates(networkInterfaces(), '3000'), 'http://localhost:3000', 'http://10.0.2.2:3000'])]; };
export default defineConfig(({ mode }) => ({ plugins: [react()], define: { __DEBUG_TABLES__: mode === 'debug' ? JSON.stringify(debugTables()) : 'null' }, server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy: { '/ws': { target: 'ws://127.0.0.1:3000', ws: true }, '/api': 'http://127.0.0.1:3000' } }, test: { include: ['server/**/*.test.ts', 'shared/**/*.test.ts'] } }));
