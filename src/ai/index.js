import { SUITS, isAceOfHearts } from '../game/cards';
import { isTrump, nonTrumpPower, trumpPower } from '../game/ranking';
import { legalPlayIndices } from '../game/play';
import { partnerOf, teamOf } from '../game/state';
import { legalBidOptions } from '../game/bidding';
/**
 * Estimate the trick value of a hand if `trump` were trump.
 * Returns expected points (0..30+) — used as a heuristic for bidding.
 */
export function estimateHandValue(hand, trump) {
    // Score each card on a coarse "tricks won" scale and the best-trump bonus.
    let trickPoints = 0;
    let bestTrumpScore = -Infinity;
    // Sort trumps by trumpPower desc.
    const trumps = hand
        .map((c) => ({ c, tp: trumpPower(c, trump) }))
        .filter((x) => x.tp !== null)
        .sort((a, b) => b.tp - a.tp);
    for (const { tp } of trumps) {
        if (tp > bestTrumpScore)
            bestTrumpScore = tp;
    }
    // Top trumps are reliable tricks.
    // 5T, JT, AH (>= 98): each ~ 0.95 trick
    // A/K of trump (>= 96): ~ 0.85 trick
    // Q of trump (95): ~ 0.6 trick
    // High pip trumps: 0.3 each
    // Low pip trumps: 0.15 each
    for (const { tp } of trumps) {
        let p;
        if (tp >= 98)
            p = 0.95;
        else if (tp >= 96)
            p = 0.8;
        else if (tp === 95)
            p = 0.55;
        else if (tp >= 10)
            p = 0.3;
        else
            p = 0.15;
        trickPoints += p * 5;
    }
    // Side-suit aces and kings are worth something but vulnerable to trumps.
    const sideCards = hand.filter((c) => !isTrump(c, trump));
    for (const c of sideCards) {
        if (c.rank === 'A')
            trickPoints += 0.55 * 5;
        else if (c.rank === 'K')
            trickPoints += 0.25 * 5;
        else if (c.rank === 'Q')
            trickPoints += 0.1 * 5;
    }
    // Bonus point if we likely have best trump.
    if (bestTrumpScore >= 95)
        trickPoints += 5;
    else if (bestTrumpScore >= 11)
        trickPoints += 2;
    return trickPoints;
}
/** Pick the trump suit that maximizes estimated hand value. */
export function pickBestTrump(hand) {
    let best = { suit: 'H', value: -Infinity };
    for (const s of SUITS) {
        const v = estimateHandValue(hand, s);
        if (v > best.value)
            best = { suit: s, value: v };
    }
    return best;
}
/**
 * Decide a bid for `seat` from its hand. Returns one of the legal bid options.
 *
 * Heuristic:
 *   - Estimate best-suit value.
 *   - Bid 20 if value >= ~17.
 *   - Bid 25 if value >= ~22.
 *   - Bid 30 if value >= ~30 (essentially monster hands).
 *   - Otherwise pass.
 */
export function aiBid(state, seat) {
    if (!state.bidding)
        return 'pass';
    const hand = state.hands[seat];
    const best = pickBestTrump(hand);
    const value = best.value;
    const legal = legalBidOptions(state.bidding, state.dealer, hand);
    // What can we afford to bid given the standing high?
    const standing = state.bidding.highBid;
    const isDealer = seat === state.dealer;
    // If standing is 0, freely choose.
    let target = 'pass';
    if (value >= 30)
        target = 30;
    else if (value >= 22)
        target = 25;
    else if (value >= 17)
        target = 20;
    // Rule: if we MUST bid (because of a 5) but our target was pass,
    // we must choose the lowest legal numeric bid.
    if (target === 'pass' && !legal.includes('pass')) {
        target = 20;
    }
    if (target === 'pass')
        return 'pass';
    // If our target equals the standing bid, dealer can take; non-dealer must pass.
    if (target === standing) {
        if (isDealer && legal.includes(target))
            return target; // dealer takes
        return 'pass';
    }
    // If our target is below standing, pass.
    if (target < standing)
        return 'pass';
    // Otherwise raise to target.
    if (legal.includes(target))
        return target;
    // Fallback: try lower amounts in case target isn't legal (shouldn't happen if standing < target).
    for (const amt of [25, 20]) {
        if (amt < target && legal.includes(amt) && amt > standing)
            return amt;
    }
    return 'pass';
}
/**
 * After winning a bid, pick which cards from (hand + kitty) to discard.
 * Returns the cards to discard (length = kitty size, since hand+kitty is 8 cards
 * and we need to end at 5).
 */
export function aiBidderDiscard(hand, kitty, trump) {
    const combined = [...hand, ...kitty];
    // Score each card by retention priority. Higher = keep.
    const scored = combined.map((c) => {
        const tp = trumpPower(c, trump);
        if (tp !== null)
            return { c, score: 1000 + tp };
        // Non-trumps: aces are worth keeping; kings are marginal.
        if (c.rank === 'A')
            return { c, score: 200 };
        if (c.rank === 'K')
            return { c, score: 100 };
        if (c.rank === 'Q')
            return { c, score: 50 };
        return { c, score: 0 };
    });
    scored.sort((a, b) => b.score - a.score);
    // Keep top 5; discard the rest.
    const discards = scored.slice(5).map((x) => x.c);
    return discards;
}
/** Non-bidder discard: throw all non-trumps below A, and keep at most 5. */
export function aiNonBidderDiscard(hand, trump) {
    // Discard non-trump cards that are unlikely to win tricks. Keep all trumps,
    // keep aces of side suits.
    const discards = [];
    for (const c of hand) {
        if (isTrump(c, trump))
            continue;
        if (c.rank === 'A')
            continue;
        if (c.rank === 'K' && hasKingProtection(hand, c))
            continue; // keep K with backup
        discards.push(c);
    }
    // Limit to a reasonable number; drawing too many on a thin stock can be bad.
    // Allow up to 4 discards (keep at least 1 + your trumps).
    const maxDiscards = Math.min(discards.length, 4);
    return discards.slice(0, maxDiscards);
}
function hasKingProtection(hand, king) {
    // King is safer if there's another card of the same suit (Q or J) with it.
    return hand.some((c) => c.suit === king.suit && c.rank !== king.rank && (c.rank === 'Q' || c.rank === 'J'));
}
/**
 * Pick a card to play given the current trick situation.
 *
 * Strategy:
 *  - If leading: lead a top trump (especially 5/J/AH) early to draw out trumps;
 *    otherwise lead an off-ace, otherwise the lowest non-trump.
 *  - If following:
 *    - If a partner is currently winning the trick, throw the lowest legal card
 *      that doesn't trump the partner.
 *    - Otherwise try to win with the lowest card that wins; if can't win,
 *      throw the lowest legal.
 */
export function aiPickCard(state, seat) {
    if (!state.trump || !state.currentTrick)
        throw new Error('Bad state for AI play');
    const trump = state.trump;
    const hand = state.hands[seat];
    const trickCards = state.currentTrick.plays.map((p) => p.card);
    const legal = legalPlayIndices(hand, trickCards, trump);
    const legalCards = legal.map((i) => hand[i]);
    if (trickCards.length === 0) {
        return chooseLead(state, seat, legalCards);
    }
    // Following play.
    // Determine current winning play & seat.
    const { winningSeat, winningCard } = currentTrickWinner(state);
    const isPartnerWinning = winningSeat !== null && partnerOf(seat) === winningSeat;
    if (isPartnerWinning) {
        // Throw lowest legal card. Don't trump partner.
        return lowestNonTrumpOrLowestLegal(legalCards, trump);
    }
    // Try to win with the lowest card that beats the current winner.
    const winners = legalCards.filter((c) => beats(c, winningCard, trump, trickCards[0].suit));
    if (winners.length > 0) {
        // Lowest winning card.
        winners.sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump));
        return winners[0];
    }
    // Can't win; throw lowest legal.
    return lowestLegalCard(legalCards, trump, trickCards[0].suit);
}
function chooseLead(state, _seat, legalCards) {
    const trump = state.trump;
    // Count remaining trumps held by opponents (rough estimate from cards seen).
    // Simple heuristic: if we have 3+ trumps including a top trump, lead trump.
    const trumps = legalCards.filter((c) => isTrump(c, trump));
    const topTrump = trumps.find((c) => {
        const tp = trumpPower(c, trump);
        return tp >= 98; // 5, J, AH
    });
    const earlyHand = state.completedTricks.length < 2;
    if (topTrump && earlyHand)
        return topTrump;
    // Lead an off-ace if available (red ace of a non-trump suit; AH is trump).
    const offAce = legalCards.find((c) => c.rank === 'A' && !isTrump(c, trump) && !isAceOfHearts(c));
    if (offAce)
        return offAce;
    // Otherwise lead the lowest non-trump.
    const nonTrumps = legalCards.filter((c) => !isTrump(c, trump));
    if (nonTrumps.length > 0) {
        nonTrumps.sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump));
        return nonTrumps[0];
    }
    // All trumps. Lead the lowest trump.
    trumps.sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump));
    return trumps[0];
}
function currentTrickWinner(state) {
    const plays = state.currentTrick.plays;
    const trump = state.trump;
    const ledSuit = plays[0].card.suit;
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < plays.length; i++) {
        const c = plays[i].card;
        const tp = trumpPower(c, trump);
        const score = tp !== null ? 1000 + tp : nonTrumpPower(c, ledSuit);
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }
    return {
        winningSeat: plays[bestIdx].seat,
        winningCard: plays[bestIdx].card,
    };
}
function beats(candidate, current, trump, ledSuit) {
    const tpC = trumpPower(candidate, trump);
    const tpW = trumpPower(current, trump);
    if (tpC !== null && tpW !== null)
        return tpC > tpW;
    if (tpC !== null && tpW === null)
        return true; // any trump beats any non-trump
    if (tpC === null && tpW !== null)
        return false;
    // Both non-trump; only matters if candidate matches led suit.
    return nonTrumpPower(candidate, ledSuit) > nonTrumpPower(current, ledSuit);
}
function cardSortValue(c, trump) {
    const tp = trumpPower(c, trump);
    if (tp !== null)
        return 1000 + tp;
    // Off-suit value (using "led" = its own suit so non-trump power is well-defined).
    return nonTrumpPower(c, c.suit);
}
function lowestLegalCard(legalCards, trump, ledSuit) {
    // Prefer to dump non-trumps first; never waste a high trump if a low non-trump is available.
    const sorted = legalCards.slice().sort((a, b) => {
        const aT = isTrump(a, trump) ? 1 : 0;
        const bT = isTrump(b, trump) ? 1 : 0;
        if (aT !== bT)
            return aT - bT; // non-trumps first
        if (aT === 1)
            return cardSortValue(a, trump) - cardSortValue(b, trump);
        // Both non-trumps: lowest of led-suit comes first, then anything off-suit.
        const aOnLed = a.suit === ledSuit ? 0 : 1;
        const bOnLed = b.suit === ledSuit ? 0 : 1;
        if (aOnLed !== bOnLed)
            return aOnLed - bOnLed;
        return cardSortValue(a, trump) - cardSortValue(b, trump);
    });
    return sorted[0];
}
function lowestNonTrumpOrLowestLegal(legalCards, trump) {
    const nonTrumps = legalCards.filter((c) => !isTrump(c, trump));
    if (nonTrumps.length > 0) {
        nonTrumps.sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump));
        return nonTrumps[0];
    }
    // Forced to play a trump even though partner is winning.
    const sorted = legalCards.slice().sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump));
    return sorted[0];
}
// Avoid unused-import warning if some helpers aren't used yet.
void teamOf;
