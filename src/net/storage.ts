import { Preferences } from '@capacitor/preferences';
import { native } from './platform';
// WKWebView can evict localStorage under storage pressure and poker-device is the de-facto credential, so native persists via Preferences (async) behind a sync cache that hydrate() fills before first render. On web this is plain localStorage.
const keys = ['poker-device', 'poker-name', 'poker-setup', 'poker-server', 'poker-route'], cache = new Map<string, string>();
export async function hydrate() {
  if (native) await Promise.all(keys.map(async key => { try { const { value } = await Preferences.get({ key }); if (value !== null) cache.set(key, value); } catch { /* Fall back to an empty value. */ } }));
}
export const storage = {
  get: (key: string) => native ? cache.get(key) ?? null : localStorage.getItem(key),
  set: (key: string, value: string) => { if (native) { cache.set(key, value); Preferences.set({ key, value }).catch(() => {}); } else localStorage.setItem(key, value); },
  remove: (key: string) => { if (native) { cache.delete(key); Preferences.remove({ key }).catch(() => {}); } else localStorage.removeItem(key); },
};
