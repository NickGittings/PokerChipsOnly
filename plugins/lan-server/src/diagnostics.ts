import { LanServer } from './index';
import type { PluginListenerHandle } from '@capacitor/core';

/** Opt-in development harness; never imported by the production app. */
export async function startEchoServer(port = 0) {
  const events: { type: string; id?: string; data?: string; message?: string }[] = [];
  const listeners: PluginListenerHandle[] = [];
  try {
    listeners.push(await LanServer.addListener('connection', ({ id }) => events.push({ type: 'connection', id })));
    listeners.push(await LanServer.addListener('message', ({ id, data }) => {
      events.push({ type: 'message', id, data });
      void LanServer.send({ connectionId: id, data }).catch(error => events.push({ type: 'error', message: String(error) }));
    }));
    listeners.push(await LanServer.addListener('close', ({ id }) => events.push({ type: 'close', id })));
    listeners.push(await LanServer.addListener('error', error => events.push({ type: 'error', message: error.message })));
    const { urls } = await LanServer.start({ port, serviceName: 'PokerChips transport test' });
    return { urls, events, stop: async () => { await LanServer.stop(); await Promise.all(listeners.map(listener => listener.remove())); } };
  } catch (error) { await Promise.all(listeners.map(listener => listener.remove())); throw error; }
}
