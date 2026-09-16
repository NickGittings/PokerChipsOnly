import type { NetworkInterfaceInfo } from 'node:os';

export function joinUrlCandidates(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, clientPort: string, override?: string): string[] {
  if (override !== undefined) return [override];
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) => (entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal)
    .map(({ address }) => {
      const prefix = /^(192\.168\.|10\.)/.test(address) ? 0 : /^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 1 : /^169\.254\./.test(address) ? 10 : 2;
      return { address, score: prefix + (/^(utun|tun|tap|bridge|docker|vboxnet|vmnet|awdl|llw)/i.test(name) ? 4 : 0) };
    })).sort((a, b) => a.score - b.score);
  return candidates.length ? [...new Set(candidates.map(({ address }) => `http://${address}:${clientPort}`))] : [`http://localhost:${clientPort}`];
}
