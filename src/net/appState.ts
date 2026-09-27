import { App } from '@capacitor/app';
import { native } from './platform';
// Belt and braces alongside visibilitychange: fires when the native app returns to the foreground. No-op on web.
export function onAppActive(fn: () => void) {
  if (!native) return () => {};
  const handle = App.addListener('appStateChange', ({ isActive }) => { if (isActive) fn(); });
  return () => { void handle.then(h => h.remove()); };
}
