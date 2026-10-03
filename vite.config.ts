import { networkInterfaces } from 'node:os';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { joinUrlCandidates } from './server/joinUrls';
import { DEFAULT_PORT, parseOrigin } from './shared/origin';
// `vite build --mode debug` bakes this laptop's game-server addresses (preferred first, then the iOS Simulator/Android emulator aliases) into the pairing screen's debug button; any other build defines null and the button compiles out. The native shell must also be a debug build for it to show (see DebugBuild in SceneDelegate.swift / DebugBuildPlugin.java).
const debugTables = () => {
  const port = process.env.PORT ?? String(DEFAULT_PORT), raw = process.env.DEBUG_SERVER, override = raw && parseOrigin(raw);
  if (raw && !override) throw new Error(`DEBUG_SERVER=${raw} is not a table address (try 192.168.1.20:3000)`);
  return override ? [override] : [...new Set([...joinUrlCandidates(networkInterfaces(), port), `http://localhost:${port}`, `http://10.0.2.2:${port}`])];
};
export default defineConfig(({ mode }) => ({ plugins: [react()], define: { __DEBUG_TABLES__: mode === 'debug' ? JSON.stringify(debugTables()) : 'null' }, server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy: { '/ws': { target: 'ws://127.0.0.1:3000', ws: true }, '/api': 'http://127.0.0.1:3000' } }, test: { include: ['server/**/*.test.ts', 'shared/**/*.test.ts'] } }));
