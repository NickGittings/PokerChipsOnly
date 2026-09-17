import { describe, expect, it } from 'vitest';
import { createGame, createPlayer } from '../server/engine/state';
import { report } from './report';

describe('night report', () => {
  it('counts buybacks and derives investment, net and biggest hand results', () => {
    const g = createGame(); g.hand = 4; g.players = [createPlayer('alice', 'Alice', 0, 3400)];
    g.ledger = [
      { hand: 0, playerId: 'alice', name: 'Alice', kind: 'buy-in', amount: 1000 },
      { hand: 1, playerId: 'alice', name: 'Alice', kind: 'buy-back', amount: 1000 },
      { hand: 2, playerId: 'alice', name: 'Alice', kind: 'buy-back', amount: 1000 },
      { hand: 3, playerId: 'alice', name: 'Alice', kind: 'hand', amount: 700 },
      { hand: 4, playerId: 'alice', name: 'Alice', kind: 'hand', amount: -300 },
    ];
    expect(report(g)).toEqual({ players: [{ playerId: 'alice', name: 'Alice', buyIns: 3, invested: 3000, finalStack: 3400, net: 400, biggestWin: { amount: 700, hand: 3 }, biggestLoss: { amount: -300, hand: 4 }, handsPlayed: 2 }], totalBuyIns: 3, hands: 4 });
  });
  it('keeps a removed player and their withdrawal after the seat is reused', () => {
    const g = createGame(); g.players = [createPlayer('new', 'New player', 0, 1000)];
    g.ledger = [
      { hand: 0, playerId: 'old', name: 'Original player', kind: 'buy-in', amount: 1000 },
      { hand: 1, playerId: 'old', name: 'Original player', kind: 'hand', amount: 200 },
      { hand: 1, playerId: 'old', name: 'Original player', kind: 'adjust', amount: -1200 },
      { hand: 1, playerId: 'new', name: 'New player', kind: 'buy-in', amount: 1000 },
    ];
    const result = report(g);
    expect(result.players.map(p => p.playerId)).toEqual(['new', 'old']);
    expect(result.players[1]).toMatchObject({ name: 'Original player', invested: -200, finalStack: 0, net: 200, biggestWin: { amount: 200, hand: 1 } });
    expect(result.totalBuyIns).toBe(2);
  });
  it('orders survivors and archived eliminated players with standings, retaining ties', () => {
    const g = createGame(); g.phase = 'tournament-over';
    g.players = [createPlayer('small', 'Small', 0, 1000), createPlayer('leader', 'Leader', 1, 2000)];
    const eliminated = createPlayer('out', 'Out', 2); eliminated.status = 'busted'; eliminated.bustOrder = 1; g.eliminated = [eliminated];
    expect(report(g).players.map(p => p.playerId)).toEqual(['leader', 'small', 'out']);
    expect(report(g).players[2]).toMatchObject({ biggestWin: null, biggestLoss: null, handsPlayed: 0 });
  });
  it('uses the current stack without double counting contributions after a partial pot award', () => {
    const g = createGame(), player = createPlayer('a', 'Alice', 0, 1500); player.committedThisHand = 1000; g.players = [player]; g.phase = 'showdown';
    g.pots = [{ amount: 1500, eligibleIds: ['a', 'b'], awarded: true, winnerIds: ['a'] }, { amount: 1000, eligibleIds: ['a', 'c'], awarded: false }];
    g.ledger = [{ hand: 0, playerId: 'a', name: 'Alice', kind: 'buy-in', amount: 1000 }];
    expect(report(g).players[0]).toMatchObject({ finalStack: 1500, net: 500, invested: 1000, biggestWin: null });
  });
  it('includes corrections in investment without calling them buybacks', () => {
    const g = createGame(); g.players = [createPlayer('a', 'Alice', 0, 1200)];
    g.ledger = [{ hand: 0, playerId: 'a', name: 'Alice', kind: 'buy-in', amount: 1000 }, { hand: 1, playerId: 'a', name: 'Alice', kind: 'adjust', amount: 200 }];
    expect(report(g).players[0]).toMatchObject({ buyIns: 1, invested: 1200, net: 0 });
  });
  it('starts an empty report for a new night', () => { expect(report(createGame())).toEqual({ players: [], totalBuyIns: 0, hands: 0 }); });
});
