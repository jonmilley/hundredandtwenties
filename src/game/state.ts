import { Card, Suit } from './cards';

export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;

/** Seats 0/2 form team 0 (you + partner across). Seats 1/3 form team 1. */
export const teamOf = (seat: Seat): Team => (seat % 2 === 0 ? 0 : 1);

export const SEATS: readonly Seat[] = [0, 1, 2, 3] as const;

export const nextSeat = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;
export const partnerOf = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;

export type BidAmount = 20 | 25 | 30;
export type BidOption = BidAmount | 'pass';

/** A bid record entered by a seat. */
export type BidEntry = { seat: Seat; option: BidOption };

export type BiddingState = {
  /** Order of seats to act, in order. */
  order: Seat[];
  /** Index in `order` of the current bidder. */
  cursor: number;
  /** Highest bid so far (the standing bid). */
  highBid: number; // 0 if none
  /** Seat holding the standing bid. */
  highBidder: Seat | null;
  /** Has the dealer "taken" the bid? If so the round goes back to the high bidder. */
  dealerTookActive: boolean;
  /** History of bid actions. */
  history: BidEntry[];
  /** True once the bidding is resolved. */
  done: boolean;
};

export type TrickPlay = { seat: Seat; card: Card };
export type Trick = { plays: TrickPlay[]; ledSuit?: Suit; winner?: Seat };

export type Phase =
  | 'intro'
  | 'deal'
  | 'bid'
  | 'kitty'      // bidder picks trump and uses the kitty
  | 'discard'    // each seat may discard then draw replacements
  | 'play'       // 5 tricks
  | 'score'
  | 'gameOver';

/** Settings the user can toggle. */
export type Settings = {
  inHoleVariant: boolean; // if true, "must bid to win at 100+" is waived when an opponent is below 0
};

export type Score = [number, number]; // [team0, team1]

export type GameState = {
  rngSeed: number;
  phase: Phase;

  dealer: Seat;
  hands: Record<Seat, Card[]>;
  kitty: Card[];
  /** Remaining undealt cards used to replenish discards. */
  stock: Card[];

  bidding: BiddingState | null;
  /** Resolved bid after the bid phase. */
  contract: { bidder: Seat; amount: BidAmount } | null;
  trump: Suit | null;

  /** Discard phase: ordered list of seats yet to act, starting clockwise from dealer+1. */
  discardQueue: Seat[];

  /** The seat to play next during the play phase. */
  toAct: Seat | null;

  currentTrick: Trick | null;
  completedTricks: Trick[];

  /** Tally of tricks won this hand, by team. */
  tricksWon: [number, number];

  totalScore: Score;
  handsPlayed: number;

  settings: Settings;
  log: string[];
  /** Increments on any state mutation; UI uses to know to re-render. */
  version: number;
};

export const HUMAN_SEAT: Seat = 0;

const STORAGE_KEY = 'h120_game_state';

export function saveState(state: GameState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state to sessionStorage', e);
  }
}

export function loadState(): GameState | null {
  try {
    const data = sessionStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to load state from sessionStorage', e);
    return null;
  }
}

export function clearSavedState(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
