import { networkInterfaces } from 'node:os';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { joinUrlCandidates } from './server/joinUrls';
import { DEFAULT_PORT, localOrigin, parseOrigin } from './shared/origin';
// `vite build --mode debug` bakes this laptop's game-server addresses (preferred first, then the iOS Simulator/Android emulator aliases) into the pairing screen's debug button; any other build defines null and the button compiles out. Only addresses PairView's localOrigin check would accept are kept, so a non-LAN interface can't win the probe and then be refused. The native shell must also be a debug build for it to show (see DebugBuild in SceneDelegate.swift / DebugBuildPlugin.java).
const debugTables = () => {
  const port = process.env.PORT ?? String(DEFAULT_PORT), raw = process.env.DEBUG_SERVER, override = raw && parseOrigin(raw);
  if (raw && !override) throw new Error(`DEBUG_SERVER=${raw} is not a table address (try 192.168.1.20:3000)`);
  if (override && !localOrigin(override)) throw new Error(`DEBUG_SERVER=${raw} isn't on the local network, so the pairing screen would refuse it (use a LAN IP, .local name or https)`);
  return override ? [override] : [...new Set([...joinUrlCandidates(networkInterfaces(), port), `http://localhost:${port}`, `http://10.0.2.2:${port}`])].filter(localOrigin);
};
export default defineConfig(({ mode }) => ({ plugins: [react()], define: { __DEBUG_TABLES__: mode === 'debug' ? JSON.stringify(debugTables()) : 'null' }, server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy: { '/ws': { target: 'ws://127.0.0.1:3000', ws: true }, '/api': 'http://127.0.0.1:3000' } }, test: { include: ['server/**/*.test.ts', 'shared/**/*.test.ts'] } }));
