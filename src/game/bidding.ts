import { Card } from './cards';
import { BidAmount, BidEntry, BidOption, BiddingState, Seat, nextSeat } from './state';

const MIN_BID = 20;

export function startBidding(dealer: Seat): BiddingState {
  const first = nextSeat(dealer);
  const order: Seat[] = [first, nextSeat(first), nextSeat(nextSeat(first)), dealer];
  return {
    order,
    cursor: 0,
    highBid: 0,
    highBidder: null,
    dealerTookActive: false,
    history: [],
    done: false,
  };
}

/** Whose turn is it to bid? Returns null if bidding is done. */
export function currentBidder(b: BiddingState): Seat | null {
  if (b.done) return null;
  return b.order[b.cursor] ?? null;
}

/**
 * Legal options for the current bidder.
 *
 * - Non-dealer: pass, or any amount strictly greater than the standing bid.
 * - Dealer: pass, raise, OR "take" (match the standing bid without raising).
 *   "Take" appears as the same numeric amount as highBid, but is only legal
 *   for the dealer.
 *
 * After a dealer take, the action goes back to the original high bidder, who
 * can pass (accepting the dealer's take) or raise. If they raise, the dealer
 * gets another chance to take or pass.
 */
export function legalBidOptions(b: BiddingState, dealer: Seat, hand?: Card[]): BidOption[] {
  const seat = currentBidder(b);
  if (seat === null) return [];

  let options: BidOption[] = ['pass'];
  const isDealer = seat === dealer;

  // Rule: If you have a 5 of any suit in your dealt hand, you must bid 20 or more.
  // You can only pass if someone has already bid 20 or more.
  if (hand && b.highBid === 0) {
    const hasFive = hand.some(c => c.rank === '5');
    if (hasFive) {
      options = [];
    }
  }

  const amounts: BidAmount[] = [20, 25, 30];
  for (const amt of amounts) {
    if (b.highBid === 0 ? amt >= MIN_BID : amt > b.highBid) options.push(amt);
  }

  if (isDealer && b.highBid > 0) {
    if (!options.includes(b.highBid as BidAmount)) options.push(b.highBid as BidAmount);
  }

  return options;
}

export type BidResolution = {
  bidder: Seat;
  amount: BidAmount;
};

/**
 * Submit a bid. Returns the new state plus an optional resolution if the
 * bidding has concluded. Throws on illegal input.
 */
export function submitBid(
  b: BiddingState,
  seat: Seat,
  option: BidOption,
  dealer: Seat,
  hand?: Card[],
): { state: BiddingState; resolution: BidResolution | null } {
  const expected = currentBidder(b);
  if (expected !== seat) throw new Error(`Not seat ${seat}'s turn to bid`);
  const legal = legalBidOptions(b, dealer, hand);
  if (!legal.includes(option)) throw new Error(`Illegal bid option: ${option}`);

  const entry: BidEntry = { seat, option };
  let state: BiddingState = { ...b, history: [...b.history, entry] };

  const isDealer = seat === dealer;

  // --- Pass branch ---
  if (option === 'pass') {
    if (state.dealerTookActive) {
      // We're in the dealer-take loop. Only the original high bidder is
      // ever asked. Their pass = accept dealer's take.
      return finalizeWith(state, dealer, state.highBid as BidAmount);
    }

    // Normal pass: advance.
    return advance(state, dealer);
  }

  // --- Numeric branch ---
  const amount = option as BidAmount;

  // Dealer "take": amount equals the standing bid.
  if (isDealer && amount === state.highBid) {
    const originalHighBidder = state.highBidder;
    if (originalHighBidder === null) {
      return finalizeWith(state, dealer, amount);
    }
    // If the standing bid is 30, the high bidder cannot raise; their only
    // legal response is to pass. Short-circuit and award the dealer.
    if (amount === 30) {
      return finalizeWith(state, dealer, 30);
    }
    state = {
      ...state,
      dealerTookActive: true,
      cursor: state.order.indexOf(originalHighBidder),
    };
    return { state, resolution: null };
  }

  // Otherwise this is a real raise (or first bid).
  const dealerAlreadyActed = state.history.slice(0, -1).some((e) => e.seat === dealer);
  state = {
    ...state,
    highBid: amount,
    highBidder: seat,
    dealerTookActive: false,
  };

  if (amount === 30) {
    if (!isDealer) {
      // Non-dealer bid 30: jump to dealer, who can pass or take.
      state = { ...state, cursor: state.order.indexOf(dealer) };
      return { state, resolution: null };
    }
    return finalizeWith(state, dealer, 30);
  }

  if (isDealer) {
    // Dealer raised. The most-recent prior non-dealer bidder gets one chance.
    const priorBidder = mostRecentNonDealerBidder(state, dealer);
    if (priorBidder === null) {
      return finalizeWith(state, dealer, amount);
    }
    state = { ...state, cursor: state.order.indexOf(priorBidder) };
    return { state, resolution: null };
  }

  // Non-dealer raise. If the dealer has already acted this session, bounce
  // back to the dealer for another response. Otherwise advance normally.
  if (dealerAlreadyActed) {
    state = { ...state, cursor: state.order.indexOf(dealer) };
    return { state, resolution: null };
  }
  return advance(state, dealer);
}

function advance(b: BiddingState, dealer: Seat): { state: BiddingState; resolution: BidResolution | null } {
  const next = b.cursor + 1;
  if (next >= b.order.length) {
    if (b.highBidder === null) {
      // All passed: dealer is forced to take 20.
      return finalizeWith(b, dealer, 20);
    }
    return finalizeWith(b, b.highBidder, b.highBid as BidAmount);
  }
  return { state: { ...b, cursor: next }, resolution: null };
}

function finalizeWith(
  b: BiddingState,
  bidder: Seat,
  amount: BidAmount,
): { state: BiddingState; resolution: BidResolution } {
  return {
    state: { ...b, done: true, highBidder: bidder, highBid: amount, dealerTookActive: false },
    resolution: { bidder, amount },
  };
}

function mostRecentNonDealerBidder(b: BiddingState, dealer: Seat): Seat | null {
  for (let i = b.history.length - 2; i >= 0; i--) {
    const e = b.history[i]!;
    if (e.option !== 'pass' && e.seat !== dealer) return e.seat;
  }
  return null;
}

export function biddingResolution(b: BiddingState): BidResolution | null {
  if (!b.done) return null;
  if (b.highBidder === null) return null;
  return { bidder: b.highBidder, amount: b.highBid as BidAmount };
}
