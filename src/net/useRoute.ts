import { useCallback, useEffect, useState } from 'react';
import { native } from './platform';
import { storage } from './storage';
// capacitor://localhost has no server rewrite behind it, so native keeps the route in state (persisted) instead of the URL.
export function useRoute() {
  const [route, setRoute] = useState(() => native ? storage.get('poker-route') ?? '/' : location.pathname);
  useEffect(() => {
    if (native) return;
    const pop = () => setRoute(location.pathname);
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  const navigate = useCallback((path: string) => { if (native) storage.set('poker-route', path); else history.pushState(null, '', path); setRoute(path); window.scrollTo(0, 0); }, []);
  return { route, navigate };
}
