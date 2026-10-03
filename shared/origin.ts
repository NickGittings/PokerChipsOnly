export const DEFAULT_PORT = 3000;
export const wsUrl = (origin: string) => `${origin.replace(/^http/, 'ws')}/ws`;
// Plain http with no typed port means the game server on DEFAULT_PORT, whether or not the scheme was typed; https is assumed to sit behind a proxy on 443. A bare authority must be host, [ipv6] or either with :port, so typos like "http:/host" are rejected instead of becoming a host named "http".
export function parseOrigin(input: string): string | null {
  const text = input.trim(); if (!text) return null;
  const rest = text.replace(/^[a-z][a-z\d+.-]*:\/\//i, ''), bare = rest === text, authority = rest.split(/[/?#\\]/)[0];
  if (bare && !/^(?:\[[^\]]*\]|[^:[\]]*)(?::\d+)?$/.test(authority)) return null;
  try { const url = new URL(bare ? `http://${text}` : text); if (url.protocol !== 'http:' && url.protocol !== 'https:') return null; if (url.protocol === 'http:' && !/:\d+$/.test(authority)) url.port = String(DEFAULT_PORT); return url.origin; } catch { return null; }
}
// Android allows cleartext app-wide (network_security_config.xml has no subnet rule), so pairing is where plain http gets held to the LAN: private/CGNAT/link-local/loopback IPs, localhost, mDNS .local and dot-less hostnames. https is fine anywhere.
export function localOrigin(origin: string): boolean {
  const url = new URL(origin), host = url.hostname.toLowerCase().replace(/^\[|\]$/g, ''); if (url.protocol === 'https:') return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/); if (v4) { const [a, b] = [+v4[1], +v4[2]]; return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127); }
  if (host.includes(':')) return host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  return host === 'localhost' || host.endsWith('.local') || !host.includes('.');
}
