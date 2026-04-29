import { nextSeat } from './state';
const MIN_BID = 20;
export function startBidding(dealer) {
    const first = nextSeat(dealer);
    const order = [first, nextSeat(first), nextSeat(nextSeat(first)), dealer];
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
export function currentBidder(b) {
    if (b.done)
        return null;
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
export function legalBidOptions(b, dealer, hand) {
    const seat = currentBidder(b);
    if (seat === null)
        return [];
    let options = ['pass'];
    const isDealer = seat === dealer;
    // Rule: If you have a 5 of any suit in your dealt hand, you must bid 20 or more.
    // You can only pass if someone has already bid 20 or more.
    if (hand && b.highBid === 0) {
        const hasFive = hand.some(c => c.rank === '5');
        if (hasFive) {
            options = [];
        }
    }
    const amounts = [20, 25, 30];
    for (const amt of amounts) {
        if (b.highBid === 0 ? amt >= MIN_BID : amt > b.highBid)
            options.push(amt);
    }
    if (isDealer && b.highBid > 0) {
        if (!options.includes(b.highBid))
            options.push(b.highBid);
    }
    return options;
}
/**
 * Submit a bid. Returns the new state plus an optional resolution if the
 * bidding has concluded. Throws on illegal input.
 */
export function submitBid(b, seat, option, dealer, hand) {
    const expected = currentBidder(b);
    if (expected !== seat)
        throw new Error(`Not seat ${seat}'s turn to bid`);
    const legal = legalBidOptions(b, dealer, hand);
    if (!legal.includes(option))
        throw new Error(`Illegal bid option: ${option}`);
    const entry = { seat, option };
    let state = { ...b, history: [...b.history, entry] };
    const isDealer = seat === dealer;
    // --- Pass branch ---
    if (option === 'pass') {
        if (state.dealerTookActive) {
            // We're in the dealer-take loop. Only the original high bidder is
            // ever asked. Their pass = accept dealer's take.
            return finalizeWith(state, dealer, state.highBid);
        }
        // Normal pass: advance.
        return advance(state, dealer);
    }
    // --- Numeric branch ---
    const amount = option;
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
function advance(b, dealer) {
    const next = b.cursor + 1;
    if (next >= b.order.length) {
        if (b.highBidder === null) {
            // All passed: dealer is forced to take 20.
            return finalizeWith(b, dealer, 20);
        }
        return finalizeWith(b, b.highBidder, b.highBid);
    }
    return { state: { ...b, cursor: next }, resolution: null };
}
function finalizeWith(b, bidder, amount) {
    return {
        state: { ...b, done: true, highBidder: bidder, highBid: amount, dealerTookActive: false },
        resolution: { bidder, amount },
    };
}
function mostRecentNonDealerBidder(b, dealer) {
    for (let i = b.history.length - 2; i >= 0; i--) {
        const e = b.history[i];
        if (e.option !== 'pass' && e.seat !== dealer)
            return e.seat;
    }
    return null;
}
export function biddingResolution(b) {
    if (!b.done)
        return null;
    if (b.highBidder === null)
        return null;
    return { bidder: b.highBidder, amount: b.highBid };
}
