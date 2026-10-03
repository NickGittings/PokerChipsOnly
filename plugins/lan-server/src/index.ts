import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface DiscoveredTable { name: string; urls: string[] }
export interface LanServerPlugin {
  /** iOS only. Use port 0 to request a free port. Register listeners before starting. */
  start(options: { port: number; serviceName: string }): Promise<{ urls: string[] }>;
  stop(): Promise<void>;
  /** Text transport only; resolves when queued, not when delivered. */
  send(options: { connectionId: string; data: string }): Promise<void>;
  /** One bounded scan; 1–15 seconds, default 3 seconds. Concurrent scans reject. */
  browse(options?: { timeoutMs?: number }): Promise<{ services: DiscoveredTable[] }>;
  addListener(event: 'connection', listener: (event: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'message', listener: (event: { id: string; data: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'close', listener: (event: { id: string }) => void): Promise<PluginListenerHandle>;
  /** Listener/publishing failures after start are asynchronous. */
  addListener(event: 'error', listener: (event: { operation: 'server' | 'advertise'; message: string }) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const LanServer = registerPlugin<LanServerPlugin>('LanServer');
