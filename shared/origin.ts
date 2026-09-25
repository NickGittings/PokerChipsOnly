export const DEFAULT_PORT = 3000;
export const wsUrl = (origin: string) => `${origin.replace(/^http/, 'ws')}/ws`;
export function parseOrigin(input: string): string | null {
  const text = input.trim(); if (!text) return null;
  try { const url = new URL(text.includes('://') ? text : `http://${text}${/:\d+$/.test(text) ? '' : `:${DEFAULT_PORT}`}`); return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null; } catch { return null; }
}
