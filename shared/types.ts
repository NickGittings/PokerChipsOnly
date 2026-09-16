export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Phase = 'lobby' | 'betting' | 'street-break' | 'showdown' | 'hand-complete' | 'tournament-over';
export type SeatStatus = 'active' | 'folded' | 'all-in' | 'busted' | 'sitting-out';
export interface Denomination { value: number; color: string }
export interface Config { name: string; denominations: Denomination[]; startingStack: number; smallBlind: number; bigBlind: number; multiplier: number; levelMinutes: number; anteMode: 'big-blind' | 'per-player' | 'none'; ante: number }
export interface Player { id: string; seat: number; name: string; stack: number; committedThisStreet: number; committedThisHand: number; deadAnte?: number; status: SeatStatus; hasActedThisRound: boolean; actedAtBet: number; place?: number; connected: boolean; handStartStack: number }
export interface Pot { amount: number; eligibleIds: string[]; awarded: boolean; winnerIds?: string[] }
export interface LogEntry { id: number; text: string }
export interface GameState { config: Config; players: Player[]; phase: Phase; street: Street; pendingStreet?: Street; hand: number; button: number; smallBlindSeat: number; bigBlindSeat: number; actorId: string | null; currentBet: number; lastFullRaiseSize: number; pots: Pot[]; log: LogEntry[]; logSequence: number; level: number; pendingLevel: number; clockRemainingMs: number; clockUpdatedAt: number; clockPaused: boolean; totalChips: number; revision: number }
export type Action = { type: 'fold' | 'check' | 'call' | 'all-in' | 'bet' | 'raise'; amount?: number };
export interface LegalActions { fold: boolean; check: boolean; call: number; allIn: boolean; canRaise: boolean; minRaiseTo: number; maxRaiseTo: number; currentCommitted: number }
export type ClientMsg = { type: 'join'; token: string; name?: string; board?: boolean } | { type: 'claimSeat'; seat: number; name: string } | { type: 'leaveSeat' } | { type: 'reclaimSeat'; playerId: string } | { type: 'setJoinUrl'; url: string } | { type: 'lateBuyIn'; name: string; seat: number } | { type: 'startTournament'; config: Config } | { type: 'action'; action: Action; revision: number } | { type: 'dealerConfirm' | 'nextHand' | 'undo' | 'pauseClock'; revision: number } | { type: 'awardPot'; potIndex: number; winnerIds: string[]; revision: number } | { type: 'hostAdjust'; playerId: string; delta: number; revision: number } | { type: 'colorUp'; revision: number };
export interface Snapshot { game: GameState; you: { id: string; host: boolean; dealer: boolean; legal: LegalActions | null }; joinUrl: string; joinUrls: string[]; canUndo: boolean; serverTime: number }
export type ServerMsg = { type: 'state'; snapshot: Snapshot } | { type: 'error'; message: string } | { type: 'event'; text: string };
