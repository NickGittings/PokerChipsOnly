import { Preferences } from '@capacitor/preferences';
import { native } from './platform';
// WKWebView can evict localStorage under storage pressure and poker-device is the de-facto credential, so native persists via Preferences (async) behind a sync cache that hydrate() fills before first render. On web this is plain localStorage.
// Every stored key is hydrated (no whitelist to keep in sync). A key whose read failed is kept session-only rather than written back, so a bridge hiccup can't make deviceToken() overwrite the real credential with a fresh one.
const cache = new Map<string, string>(), unreadable = new Set<string>(); let blind = false;
const retry = async <T,>(read: () => Promise<T>) => { try { return await read(); } catch { return await read(); } };
export async function hydrate() {
  if (!native) return;
  let keys: string[]; try { ({ keys } = await retry(() => Preferences.keys())); } catch { blind = true; return; }
  await Promise.all(keys.map(async key => { try { const { value } = await retry(() => Preferences.get({ key })); if (value !== null) cache.set(key, value); } catch { unreadable.add(key); } }));
}
const persist = (key: string) => !blind && !unreadable.has(key);
export const storage = {
  get: (key: string) => native ? cache.get(key) ?? null : localStorage.getItem(key),
  set: (key: string, value: string) => { if (native) { cache.set(key, value); if (persist(key)) Preferences.set({ key, value }).catch(() => {}); } else localStorage.setItem(key, value); },
  remove: (key: string) => { if (native) { cache.delete(key); if (persist(key)) Preferences.remove({ key }).catch(() => {}); } else localStorage.removeItem(key); },
};
