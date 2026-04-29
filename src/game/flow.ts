import { Card, Suit, buildDeck, shuffle } from './cards';
import { trickWinnerIndex } from './ranking';
import { isLegalPlay } from './play';
import {
  startBidding,
  submitBid,
  biddingResolution,
  legalBidOptions,
  currentBidder,
} from './bidding';
import {
  applyEndgameRule,
  isGameOver,
  scoreHand,
  HandResult,
} from './scoring';
import {
  BidOption,
  GameState,
  HUMAN_SEAT,
  Seat,
  Settings,
  nextSeat,
  teamOf,
} from './state';

const HAND_SIZE = 5;
const KITTY_SIZE = 3;

/** Mulberry32 PRNG so games are deterministic given a seed. */
export function rngFromSeed(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeInitialState(seed: number, settings?: Partial<Settings>): GameState {
  const dealer: Seat = 3; // first deal: dealer to right of you (seat 3); you (0) bid first
  const state: GameState = {
    rngSeed: seed,
    phase: 'intro',
    dealer,
    hands: { 0: [], 1: [], 2: [], 3: [] } as GameState['hands'],
    kitty: [],
    stock: [],
    bidding: null,
    contract: null,
    trump: null,
    discardQueue: [],
    toAct: null,
    currentTrick: null,
    completedTricks: [],
    tricksWon: [0, 0],
    totalScore: [0, 0],
    handsPlayed: 0,
    settings: { inHoleVariant: false, ...settings },
    log: [],
    version: 0,
  };
  return state;
}

/** Deal a fresh hand and move to the bidding phase. Mutates state in place. */
export function dealHand(state: GameState): void {
  const rng = rngFromSeed(state.rngSeed + state.handsPlayed * 1000003);
  const deck = shuffle(buildDeck(), rng);

  state.hands = { 0: [], 1: [], 2: [], 3: [] } as GameState['hands'];
  state.kitty = [];
  state.stock = [];

  // Deal 5 to each player starting clockwise from dealer+1.
  let idx = 0;
  const dealOrder: Seat[] = [
    nextSeat(state.dealer),
    nextSeat(nextSeat(state.dealer)),
    nextSeat(nextSeat(nextSeat(state.dealer))),
    state.dealer,
  ];
  // Single-pass deal of 5 each (could also be 5 rounds of 1; outcome is identical
  // given the deck is already shuffled).
  for (const seat of dealOrder) {
    for (let i = 0; i < HAND_SIZE; i++) {
      state.hands[seat].push(deck[idx++]!);
    }
  }
  // 3 to kitty.
  for (let i = 0; i < KITTY_SIZE; i++) state.kitty.push(deck[idx++]!);
  // Rest is stock for replacements during discard phase.
  state.stock = deck.slice(idx);

  // Reset hand state.
  state.bidding = startBidding(state.dealer);
  state.contract = null;
  state.trump = null;
  state.discardQueue = [];
  state.toAct = null;
  state.currentTrick = null;
  state.completedTricks = [];
  state.tricksWon = [0, 0];
  state.phase = 'bid';
  state.log.push(`Hand ${state.handsPlayed + 1} dealt; dealer is seat ${state.dealer}.`);
  state.version++;
}

export function getCurrentBidderSeat(state: GameState): Seat | null {
  if (!state.bidding) return null;
  return currentBidder(state.bidding);
}

export function getLegalBidOptions(state: GameState): BidOption[] {
  if (!state.bidding) return [];
  return legalBidOptions(state.bidding, state.dealer);
}

/** Submit a bid for the current bidder. Advances phase if bidding resolves. */
export function submitBidAction(state: GameState, seat: Seat, option: BidOption): void {
  if (!state.bidding) throw new Error('No bidding state');
  const { state: nextB } = submitBid(state.bidding, seat, option, state.dealer);
  state.bidding = nextB;
  state.log.push(`Seat ${seat}: ${option === 'pass' ? 'pass' : `bid ${option}`}`);
  if (state.bidding.done) {
    const res = biddingResolution(state.bidding);
    if (res) {
      state.contract = res;
      state.phase = 'kitty';
      state.log.push(`Seat ${res.bidder} won the bid at ${res.amount}.`);
    }
  }
  state.version++;
}

/**
 * Bidder takes the kitty: trump suit is named, kitty cards are added to bidder's
 * hand, and bidder must discard back down to 5. The discard list represents
 * the cards the bidder is throwing away.
 */
export function setTrumpAndTakeKitty(
  state: GameState,
  trump: Suit,
  bidderDiscards: Card[],
): void {
  if (state.phase !== 'kitty') throw new Error('Not in kitty phase');
  if (!state.contract) throw new Error('No contract');
  const bidder = state.contract.bidder;
  state.trump = trump;
  // Combine kitty into hand.
  const combined = [...state.hands[bidder], ...state.kitty];
  state.kitty = [];
  // Verify discards exist in combined hand and that at least the kitty is returned.
  const minDiscard = combined.length - HAND_SIZE; // must discard at least KITTY_SIZE (3)
  if (bidderDiscards.length < minDiscard) {
    throw new Error(`Must discard at least ${minDiscard} cards`);
  }
  const remaining = removeCards(combined, bidderDiscards);
  // Draw replacements from stock for any discards beyond the minimum.
  const extraDraw = HAND_SIZE - remaining.length;
  const drawn = extraDraw > 0 ? state.stock.splice(0, extraDraw) : [];
  state.hands[bidder] = [...remaining, ...drawn];
  // All bidder discards go to stock for the other players' discard phase.
  state.stock = [...state.stock, ...bidderDiscards];

  // Set up the discard queue: clockwise from dealer+1, skipping the bidder
  // (they've already settled their hand).
  const order: Seat[] = [
    nextSeat(state.dealer),
    nextSeat(nextSeat(state.dealer)),
    nextSeat(nextSeat(nextSeat(state.dealer))),
    state.dealer,
  ];
  state.discardQueue = order.filter((s) => s !== bidder);
  state.phase = 'discard';
  const drawNote = drawn.length > 0 ? `, drew ${drawn.length} from deck` : '';
  state.log.push(`Trump is ${trump}; bidder discarded ${bidderDiscards.length} card(s)${drawNote}.`);
  state.version++;
}

/** A non-bidder discards some cards and draws replacements from stock. */
export function discardAndDraw(state: GameState, seat: Seat, discards: Card[]): void {
  if (state.phase !== 'discard') throw new Error('Not in discard phase');
  if (state.discardQueue[0] !== seat) throw new Error(`Not seat ${seat}'s turn to discard`);
  const remaining = removeCards(state.hands[seat], discards);
  // Draw replacements from stock.
  const drawn = state.stock.splice(0, discards.length);
  state.hands[seat] = [...remaining, ...drawn];
  // Discarded cards are NOT returned to stock (they're out of play this hand).
  state.discardQueue.shift();
  state.log.push(`Seat ${seat} discarded ${discards.length} card(s).`);

  if (state.discardQueue.length === 0) {
    // Move to play phase. Lead is bidder+1 clockwise.
    if (!state.contract) throw new Error('No contract');
    state.toAct = nextSeat(state.contract.bidder);
    state.currentTrick = { plays: [] };
    state.phase = 'play';
    state.log.push(`Play begins; lead is seat ${state.toAct}.`);
  }
  state.version++;
}

/**
 * Play a card from `seat`'s hand. Validates legality, advances trick / hand.
 * For 30 bids the first card of the first trick must be a trump (the bid-30
 * "whist" rule); we enforce that here as well.
 */
export function playCard(state: GameState, seat: Seat, card: Card): void {
  if (state.phase !== 'play') throw new Error('Not in play phase');
  if (state.toAct !== seat) throw new Error(`Not seat ${seat}'s turn`);
  if (!state.trump || !state.currentTrick || !state.contract) throw new Error('Bad state');

  const idx = indexOfCard(state.hands[seat], card);
  if (idx < 0) throw new Error('Card not in hand');

  // Bid-30 whist: opponents' first card of first trick must be a trump.
  if (
    state.contract.amount === 30 &&
    state.completedTricks.length === 0 &&
    state.currentTrick.plays.length === 0 &&
    teamOf(seat) !== teamOf(state.contract.bidder)
  ) {
    // Force trump lead. If the seat has no trump at all, allow any card.
    const hasTrump = state.hands[seat].some((c) => isCardTrump(c, state.trump!));
    const playedIsTrump = isCardTrump(card, state.trump);
    if (hasTrump && !playedIsTrump) throw new Error('Bid-30: opponent must lead a trump');
  }

  if (!isLegalPlay(state.hands[seat], state.currentTrick.plays.map((p) => p.card), state.trump, idx)) {
    throw new Error('Illegal play (renege rule)');
  }

  // Move card to trick.
  state.hands[seat] = [...state.hands[seat].slice(0, idx), ...state.hands[seat].slice(idx + 1)];
  state.currentTrick.plays.push({ seat, card });
  if (state.currentTrick.plays.length === 1) {
    state.currentTrick.ledSuit = card.suit;
  }
  state.log.push(`Seat ${seat} plays ${card.rank}${card.suit}`);

  if (state.currentTrick.plays.length === 4) {
    // Trick complete.
    const winnerLocalIdx = trickWinnerIndex(
      state.currentTrick.plays.map((p) => p.card),
      state.trump,
    );
    const winnerSeat = state.currentTrick.plays[winnerLocalIdx]!.seat;
    state.currentTrick.winner = winnerSeat;
    state.tricksWon[teamOf(winnerSeat)]++;
    state.completedTricks.push(state.currentTrick);
    state.log.push(`Trick won by seat ${winnerSeat}.`);
    if (state.completedTricks.length === HAND_SIZE) {
      // Hand complete -> score.
      state.toAct = null;
      state.currentTrick = null;
      state.phase = 'score';
    } else {
      state.currentTrick = { plays: [] };
      state.toAct = winnerSeat;
    }
  } else {
    state.toAct = nextSeat(seat);
  }
  state.version++;
}

/** Resolve the score phase: compute hand result, apply to totals, advance dealer. */
export function resolveScorePhase(state: GameState): HandResult {
  if (state.phase !== 'score') throw new Error('Not in score phase');
  if (!state.contract || !state.trump) throw new Error('Bad state');
  const result = scoreHand(state.completedTricks, state.trump, state.contract);
  state.totalScore = applyEndgameRule(
    state.totalScore,
    result.pointsByTeam,
    state.contract,
    state.settings.inHoleVariant,
  );
  state.handsPlayed++;
  state.log.push(
    `Hand result: bidder ${state.contract.bidder} (team ${teamOf(state.contract.bidder)}) ` +
      `${result.bidMade ? 'MADE' : 'FAILED'} bid of ${state.contract.amount}. ` +
      `Score: ${state.totalScore[0]}-${state.totalScore[1]}.`,
  );

  if (isGameOver(state.totalScore)) {
    state.phase = 'gameOver';
  } else {
    state.dealer = nextSeat(state.dealer);
    state.phase = 'deal';
  }
  state.version++;
  return result;
}

// --- helpers ---

function removeCards(hand: Card[], remove: Card[]): Card[] {
  const out = hand.slice();
  for (const r of remove) {
    const i = out.findIndex((c) => c.suit === r.suit && c.rank === r.rank);
    if (i < 0) throw new Error(`Card ${r.rank}${r.suit} not in hand`);
    out.splice(i, 1);
  }
  return out;
}

function indexOfCard(hand: Card[], card: Card): number {
  return hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
}

function isCardTrump(c: Card, trump: Suit): boolean {
  // Inline copy to avoid import cycle.
  if (c.suit === trump) return true;
  if (c.suit === 'H' && c.rank === 'A') return true;
  return false;
}

export const HUMAN = HUMAN_SEAT;
