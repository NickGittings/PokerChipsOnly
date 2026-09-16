import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { joinUrlCandidates } from './joinUrls';

const address = (ip: string, internal = false, family = 'IPv4') => ({ address: ip, internal, family } as NetworkInterfaceInfo);
describe('LAN join URLs', () => {
  it('ranks private LANs ahead of virtual adapters and link-local addresses, removing duplicates', () => {
    const interfaces = {
      utun0: [address('10.8.0.1')], docker0: [address('172.17.0.1')],
      en0: [address('169.254.1.2'), address('203.0.113.2'), address('172.31.1.2'), address('192.168.1.2'), address('10.0.0.2'), address('::1', false, 'IPv6')],
      en1: [address('192.168.1.2')], lo0: [address('127.0.0.1', true)], absent: undefined,
    };
    expect(joinUrlCandidates(interfaces, '5173')).toEqual(['192.168.1.2', '10.0.0.2', '172.31.1.2', '203.0.113.2', '10.8.0.1', '172.17.0.1', '169.254.1.2'].map(ip => `http://${ip}:5173`));
  });
  it('uses LAN_URL exclusively and falls back to localhost without IPv4 interfaces', () => {
    expect(joinUrlCandidates({ en0: [address('192.168.1.2')] }, '5173', 'http://127.0.0.1:3301')).toEqual(['http://127.0.0.1:3301']);
    expect(joinUrlCandidates({}, '3000')).toEqual(['http://localhost:3000']);
  });
});
