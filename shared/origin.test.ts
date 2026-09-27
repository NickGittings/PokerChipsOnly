import { describe, expect, it } from 'vitest';
import { parseOrigin, wsUrl } from './origin';

describe('wsUrl', () => {
  it.each([
    ['http://192.168.1.20:3000', 'ws://192.168.1.20:3000/ws'],
    ['https://table.example.com', 'wss://table.example.com/ws'],
    ['http://localhost:5173', 'ws://localhost:5173/ws'],
  ])('%s -> %s', (origin, expected) => expect(wsUrl(origin)).toBe(expected));
});

describe('parseOrigin', () => {
  it.each([
    ['http://192.168.1.20:3000', 'http://192.168.1.20:3000'],
    ['http://192.168.1.20:3000/', 'http://192.168.1.20:3000'],
    ['http://192.168.1.20:3000/board?x=1', 'http://192.168.1.20:3000'],
    ['  192.168.1.20:3000  ', 'http://192.168.1.20:3000'],
    ['192.168.1.20', 'http://192.168.1.20:3000'],
    ['localhost:4000', 'http://localhost:4000'],
    ['192.168.1.20/', 'http://192.168.1.20:3000'],
    ['localhost/board', 'http://localhost:3000'],
    ['192.168.1.20?x=1', 'http://192.168.1.20:3000'],
    ['192.168.1.20:4000/board', 'http://192.168.1.20:4000'],
    ['192.168.1.20:80', 'http://192.168.1.20'],
    ['[::1]', 'http://[::1]:3000'],
    ['[::1]:4000/', 'http://[::1]:4000'],
    ['https://table.example.com', 'https://table.example.com'],
    ['http://192.168.1.20', 'http://192.168.1.20:3000'],
    ['http://192.168.1.20:80', 'http://192.168.1.20'],
    ['192.168.1.20/?next=http://x', 'http://192.168.1.20:3000'],
    ['192.168.1.20:4000\\board', 'http://192.168.1.20:4000'],
  ])('%j -> %s', (input, expected) => expect(parseOrigin(input)).toBe(expected));

  it.each(['', '   ', 'ftp://192.168.1.20', 'capacitor://localhost', 'http://', 'not a url', 'http:/192.168.1.20', 'host:abc'])('rejects %j', input => expect(parseOrigin(input)).toBeNull());
});
