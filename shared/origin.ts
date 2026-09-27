export const DEFAULT_PORT = 3000;
export const wsUrl = (origin: string) => `${origin.replace(/^http/, 'ws')}/ws`;
// Plain http with no typed port means the game server on DEFAULT_PORT, whether or not the scheme was typed; https is assumed to sit behind a proxy on 443. A bare authority must be host, [ipv6] or either with :port, so typos like "http:/host" are rejected instead of becoming a host named "http".
export function parseOrigin(input: string): string | null {
  const text = input.trim(); if (!text) return null;
  const rest = text.replace(/^[a-z][a-z\d+.-]*:\/\//i, ''), bare = rest === text, authority = rest.split(/[/?#\\]/)[0];
  if (bare && !/^(?:\[[^\]]*\]|[^:[\]]*)(?::\d+)?$/.test(authority)) return null;
  try { const url = new URL(bare ? `http://${text}` : text); if (url.protocol !== 'http:' && url.protocol !== 'https:') return null; if (url.protocol === 'http:' && !/:\d+$/.test(authority)) url.port = String(DEFAULT_PORT); return url.origin; } catch { return null; }
}
