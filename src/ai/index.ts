import { Card, cardId, RANKS, Suit, SUITS, isAceOfHearts } from '../game/cards';
import { isTrump, nonTrumpPower, trumpPower } from '../game/ranking';
import { legalPlayIndices } from '../game/play';
import { BidAmount, BidOption, GameState, Seat, partnerOf, teamOf } from '../game/state';
import { legalBidOptions } from '../game/bidding';

/**
 * Estimate the trick value of a hand if `trump` were trump.
 * Returns expected points (0..30+) — used as a heuristic for bidding.
 */
export function estimateHandValue(hand: Card[], trump: Suit): number {
  // Score each card on a coarse "tricks won" scale and the best-trump bonus.
  let trickPoints = 0;
  let bestTrumpScore = -Infinity;

  // Sort trumps by trumpPower desc.
  const trumps = hand
    .map((c) => ({ c, tp: trumpPower(c, trump) }))
    .filter((x): x is { c: Card; tp: number } => x.tp !== null)
    .sort((a, b) => b.tp - a.tp);

  for (const { tp } of trumps) {
    if (tp > bestTrumpScore) bestTrumpScore = tp;
  }

  // Top trumps are reliable tricks.
  // 5T, JT, AH (>= 98): each ~ 0.95 trick
  // A/K of trump (>= 96): ~ 0.85 trick
  // Q of trump (95): ~ 0.6 trick
  // High pip trumps: 0.3 each
  // Low pip trumps: 0.15 each
  for (const { tp } of trumps) {
    let p: number;
    if (tp >= 98) p = 0.95;
    else if (tp >= 96) p = 0.8;
    else if (tp === 95) p = 0.55;
    else if (tp >= 10) p = 0.3;
    else p = 0.15;
    trickPoints += p * 5;
  }

  // Side-suit aces and kings are worth something but vulnerable to trumps.
  const sideCards = hand.filter((c) => !isTrump(c, trump));
  for (const c of sideCards) {
    if (c.rank === 'A') trickPoints += 0.55 * 5;
    else if (c.rank === 'K') trickPoints += 0.25 * 5;
    else if (c.rank === 'Q') trickPoints += 0.1 * 5;
  }

  // Bonus point if we likely have best trump.
  if (bestTrumpScore >= 95) trickPoints += 5;
  else if (bestTrumpScore >= 11) trickPoints += 2;

  return trickPoints;
}

/** Pick the trump suit that maximizes estimated hand value. */
export function pickBestTrump(hand: Card[]): { suit: Suit; value: number } {
  let best: { suit: Suit; value: number } = { suit: 'H', value: -Infinity };
  for (const s of SUITS) {
    const v = estimateHandValue(hand, s);
    if (v > best.value) best = { suit: s, value: v };
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
export function aiBid(state: GameState, seat: Seat): BidOption {
  if (!state.bidding) return 'pass';
  const hand = state.hands[seat];
  const best = pickBestTrump(hand);
  const value = best.value;
  const legal = legalBidOptions(state.bidding, state.dealer, hand);

  // Context adjustments before thresholds.
  let adjustedValue = value;

  // Holding 2+ of {5T, JT, AH}: top trumps protect each other, making the hand
  // more reliable than the raw sum suggests.
  const topTrumpCount = hand.filter((c) => {
    const tp = trumpPower(c, best.suit);
    return tp !== null && tp >= 98;
  }).length;
  if (topTrumpCount >= 2) adjustedValue += 2;

  // Partner bid signal: their strength complements ours.
  const pBid = partnerBidAmount(state, seat);
  if (pBid !== null && pBid >= 25) adjustedValue += 2;
  else if (pBid !== null) adjustedValue += 1;

  // What can we afford to bid given the standing high?
  const standing = state.bidding.highBid;
  const isDealer = seat === state.dealer;

  let target: BidAmount | 'pass' = 'pass';
  if (adjustedValue >= 30) target = 30;
  else if (adjustedValue >= 22) target = 25;
  else if (adjustedValue >= 17) target = 20;

  // Rule: if we MUST bid (because of a 5) but our target was pass,
  // we must choose the lowest legal numeric bid.
  if (target === 'pass' && !legal.includes('pass')) {
    target = 20;
  }

  if (target === 'pass') return 'pass';

  // If our target equals the standing bid, dealer can take; non-dealer must pass.
  if (target === standing) {
    if (isDealer && legal.includes(target)) return target; // dealer takes
    return 'pass';
  }

  // If our target is below standing, pass.
  if (target < standing) return 'pass';

  // Otherwise raise to target.
  if (legal.includes(target)) return target;
  // Fallback: try lower amounts in case target isn't legal (shouldn't happen if standing < target).
  for (const amt of [25, 20] as BidAmount[]) {
    if (amt < target && legal.includes(amt) && amt > standing) return amt;
  }
  return 'pass';
}

/**
 * After winning a bid, pick which cards from (hand + kitty) to discard.
 * Returns the cards to discard (length = kitty size, since hand+kitty is 8 cards
 * and we need to end at 5).
 */
export function aiBidderDiscard(hand: Card[], kitty: Card[], trump: Suit): Card[] {
  const combined = [...hand, ...kitty];
  // Score each card by retention priority. Higher = keep.
  const scored = combined.map((c) => {
    const tp = trumpPower(c, trump);
    if (tp !== null) return { c, score: 1000 + tp };
    // Non-trumps: aces are worth keeping; kings are marginal.
    if (c.rank === 'A') return { c, score: 200 };
    if (c.rank === 'K') return { c, score: 100 };
    if (c.rank === 'Q') return { c, score: 50 };
    return { c, score: 0 };
  });
  scored.sort((a, b) => b.score - a.score);
  // Keep top 5; discard the rest.
  const discards = scored.slice(5).map((x) => x.c);
  return discards;
}

/**
 * Non-bidder discard: keep all trumps and side-suit aces; discard everything
 * else. Discarding a whole suit creates a void for ruffing, which is worth
 * more than holding low/mid cards in a suit.
 */
export function aiNonBidderDiscard(hand: Card[], trump: Suit): Card[] {
  const sideCards = hand.filter((c) => !isTrump(c, trump));

  const bySuit = new Map<Suit, Card[]>();
  for (const c of sideCards) {
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
    bySuit.get(c.suit)!.push(c);
  }

  const discards: Card[] = [];
  for (const [, cards] of bySuit) {
    const ace = cards.find((c) => c.rank === 'A');
    if (ace) {
      // Keep the ace; discard all other cards in this suit.
      discards.push(...cards.filter((c) => c !== ace));
    } else {
      // No ace: discard the entire suit to create a void for ruffing.
      discards.push(...cards);
    }
  }
  return discards;
}

/**
 * Pick a card to play given the current trick situation.
 *
 * Strategy:
 *  - Run-in rule: the seat immediately before the bidder must play their best
 *    trump whenever the bidder hasn't yet played in the trick, to force the
 *    bidder to use a trump.
 *  - If leading: lead an off-ace, otherwise the lowest non-trump (never open
 *    with trump when a non-trump option exists).
 *  - If following:
 *    - If a partner is currently winning the trick, throw the lowest legal card
 *      that doesn't trump the partner.
 *    - Otherwise try to win with the lowest card that wins; if can't win,
 *      throw the lowest legal.
 */
export function aiPickCard(state: GameState, seat: Seat): Card {
  if (!state.trump || !state.currentTrick) throw new Error('Bad state for AI play');
  const trump = state.trump;
  const hand = state.hands[seat];
  const trickCards = state.currentTrick.plays.map((p) => p.card);
  const legal = legalPlayIndices(hand, trickCards, trump);
  const legalCards = legal.map((i) => hand[i]!);

  // Run-in rule: seat (bidder+3)%4 plays immediately before the bidder in every
  // trick. When the bidder hasn't played yet, this seat must lead with their best
  // trump to pressure the bidder.
  if (state.contract) {
    const bidder = state.contract.bidder;
    const runInSeat = ((bidder + 3) % 4) as Seat;
    const bidderHasPlayed = state.currentTrick.plays.some((p) => p.seat === bidder);
    if (seat === runInSeat && !bidderHasPlayed) {
      const trumpCards = legalCards.filter((c) => isTrump(c, trump));
      if (trumpCards.length > 0) {
        trumpCards.sort((a, b) => cardSortValue(b, trump) - cardSortValue(a, trump));
        return trumpCards[0]!;
      }
    }
  }

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
  const winners = legalCards.filter((c) => beats(c, winningCard, trump, trickCards[0]!.suit));
  if (winners.length > 0) {
    // Lowest winning card.
    winners.sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump));
    return winners[0]!;
  }

  // Can't win; throw lowest legal.
  return lowestLegalCard(legalCards, trump, trickCards[0]!.suit);
}

function chooseLead(state: GameState, seat: Seat, legalCards: Card[]): Card {
  const trump = state.trump!;
  const dead = getDeadCards(state);
  const partner = partnerOf(seat);
  const [opp1, opp2] = opponentsOf(seat);

  // Bid-30 rule: when opposing a 30-bid, the first lead of the hand must be trump.
  if (
    state.contract?.amount === 30 &&
    state.completedTricks.length === 0 &&
    state.currentTrick!.plays.length === 0 &&
    teamOf(seat) !== teamOf(state.contract.bidder)
  ) {
    const trumpCards = legalCards.filter((c) => isTrump(c, trump));
    if (trumpCards.length > 0) {
      return trumpCards.slice().sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump))[0]!;
    }
  }

  // Off-ace lead (AH is trump, excluded).
  const offAce = legalCards.find((c) => c.rank === 'A' && !isTrump(c, trump) && !isAceOfHearts(c));
  if (offAce) return offAce;

  // Infer void suits from completed tricks.
  const partnerVoids = inferVoids(state, partner);
  const opp1Voids = inferVoids(state, opp1);
  const opp2Voids = inferVoids(state, opp2);

  // Partner ruff setup: lead a suit where partner has shown a void, provided we
  // won't be feeding both opponents an equal ruff opportunity at the same time.
  const ruffLeads = legalCards.filter(
    (c) =>
      !isTrump(c, trump) &&
      partnerVoids.has(c.suit) &&
      !(opp1Voids.has(c.suit) && opp2Voids.has(c.suit)),
  );
  if (ruffLeads.length > 0) {
    ruffLeads.sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump));
    return ruffLeads[0]!;
  }

  // Bidder leads best trump when it's the highest remaining — draws out enemy trumps.
  if (state.contract && seat === state.contract.bidder) {
    const myHandIds = new Set(state.hands[seat].map(cardId));
    const ownTrumps = legalCards
      .filter((c) => isTrump(c, trump))
      .sort((a, b) => trumpPower(b, trump)! - trumpPower(a, trump)!);
    if (ownTrumps.length > 0 && isHighestRemainingTrump(ownTrumps[0]!, trump, dead, myHandIds)) {
      return ownTrumps[0]!;
    }
  }

  // Lead a non-trump, avoiding suits where both opponents have shown a void
  // (both would ruff).
  const safeNonTrumps = legalCards.filter(
    (c) => !isTrump(c, trump) && !(opp1Voids.has(c.suit) && opp2Voids.has(c.suit)),
  );
  const nonTrumpPool = safeNonTrumps.length > 0
    ? safeNonTrumps
    : legalCards.filter((c) => !isTrump(c, trump));
  if (nonTrumpPool.length > 0) {
    nonTrumpPool.sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump));
    return nonTrumpPool[0]!;
  }

  // All trumps: lead lowest.
  return legalCards.slice().sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump))[0]!;
}

function currentTrickWinner(state: GameState): { winningSeat: Seat | null; winningCard: Card } {
  const plays = state.currentTrick!.plays;
  const trump = state.trump!;
  const ledSuit = plays[0]!.card.suit;
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < plays.length; i++) {
    const c = plays[i]!.card;
    const tp = trumpPower(c, trump);
    const score = tp !== null ? 1000 + tp : nonTrumpPower(c, ledSuit);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return {
    winningSeat: plays[bestIdx]!.seat,
    winningCard: plays[bestIdx]!.card,
  };
}

function beats(candidate: Card, current: Card, trump: Suit, ledSuit: Suit): boolean {
  const tpC = trumpPower(candidate, trump);
  const tpW = trumpPower(current, trump);
  if (tpC !== null && tpW !== null) return tpC > tpW;
  if (tpC !== null && tpW === null) return true; // any trump beats any non-trump
  if (tpC === null && tpW !== null) return false;
  // Both non-trump; only matters if candidate matches led suit.
  return nonTrumpPower(candidate, ledSuit) > nonTrumpPower(current, ledSuit);
}

function cardSortValue(c: Card, trump: Suit): number {
  const tp = trumpPower(c, trump);
  if (tp !== null) return 1000 + tp;
  // Off-suit value (using "led" = its own suit so non-trump power is well-defined).
  return nonTrumpPower(c, c.suit);
}

function lowestLegalCard(legalCards: Card[], trump: Suit, ledSuit: Suit): Card {
  const sorted = legalCards.slice().sort((a, b) => {
    const aT = isTrump(a, trump) ? 1 : 0;
    const bT = isTrump(b, trump) ? 1 : 0;
    if (aT !== bT) return aT - bT; // non-trumps first
    if (aT === 1) {
      // Never throw a renege-eligible trump (5T/JT/AH) when a regular trump is available.
      const aRenege = trumpPower(a, trump)! >= 98 ? 1 : 0;
      const bRenege = trumpPower(b, trump)! >= 98 ? 1 : 0;
      if (aRenege !== bRenege) return aRenege - bRenege;
      return cardSortValue(a, trump) - cardSortValue(b, trump);
    }
    // Both non-trumps: lowest of led-suit first, then off-suit.
    const aOnLed = a.suit === ledSuit ? 0 : 1;
    const bOnLed = b.suit === ledSuit ? 0 : 1;
    if (aOnLed !== bOnLed) return aOnLed - bOnLed;
    return cardSortValue(a, trump) - cardSortValue(b, trump);
  });
  return sorted[0]!;
}

function lowestNonTrumpOrLowestLegal(legalCards: Card[], trump: Suit): Card {
  const nonTrumps = legalCards.filter((c) => !isTrump(c, trump));
  if (nonTrumps.length > 0) {
    nonTrumps.sort((a, b) => cardSortValue(a, trump) - cardSortValue(b, trump));
    return nonTrumps[0]!;
  }
  // Forced to play trump with partner winning: throw cheapest non-renege trump first.
  const sorted = legalCards.slice().sort((a, b) => {
    const aRenege = trumpPower(a, trump)! >= 98 ? 1 : 0;
    const bRenege = trumpPower(b, trump)! >= 98 ? 1 : 0;
    if (aRenege !== bRenege) return aRenege - bRenege;
    return cardSortValue(a, trump) - cardSortValue(b, trump);
  });
  return sorted[0]!;
}

/** Cards from completed tricks and the current trick in progress. */
function getDeadCards(state: GameState): Set<string> {
  const dead = new Set<string>();
  for (const t of state.completedTricks) {
    for (const p of t.plays) dead.add(cardId(p.card));
  }
  if (state.currentTrick) {
    for (const p of state.currentTrick.plays) dead.add(cardId(p.card));
  }
  return dead;
}

/**
 * Returns true if no trump with higher power than `card` remains unaccounted
 * for (i.e., every such trump is either dead or already in `myHandIds`).
 */
function isHighestRemainingTrump(
  card: Card,
  trump: Suit,
  dead: Set<string>,
  myHandIds: Set<string>,
): boolean {
  const myPower = trumpPower(card, trump);
  if (myPower === null) return false;
  for (const rank of RANKS) {
    const candidate: Card = { rank, suit: trump };
    const tp = trumpPower(candidate, trump);
    if (tp !== null && tp > myPower) {
      const key = cardId(candidate);
      if (!dead.has(key) && !myHandIds.has(key)) return false;
    }
  }
  // AH is always trump even when trump is not Hearts.
  if (trump !== 'H') {
    const ah: Card = { rank: 'A', suit: 'H' };
    const ahPower = trumpPower(ah, trump)!; // 98
    if (ahPower > myPower && !dead.has(cardId(ah)) && !myHandIds.has(cardId(ah))) return false;
  }
  return true;
}

/** The two seats on the opposing team from `seat`. */
function opponentsOf(seat: Seat): [Seat, Seat] {
  return [((seat + 1) % 4) as Seat, ((seat + 3) % 4) as Seat];
}

/**
 * Suits where `target` has likely voided: every trick where a non-trump was
 * led and `target` responded with a trump is treated as evidence of a void in
 * that led suit.
 */
function inferVoids(state: GameState, target: Seat): Set<Suit> {
  const trump = state.trump!;
  const voids = new Set<Suit>();
  for (const trick of state.completedTricks) {
    const ledCard = trick.plays[0]?.card;
    if (!ledCard || isTrump(ledCard, trump)) continue;
    const play = trick.plays.find((p) => p.seat === target);
    if (play && isTrump(play.card, trump)) {
      voids.add(ledCard.suit);
    }
  }
  return voids;
}

/**
 * Returns the highest numeric amount partner bid in the current auction, or
 * null if partner passed or hasn't acted yet.
 */
function partnerBidAmount(state: GameState, seat: Seat): BidAmount | null {
  if (!state.bidding) return null;
  const partner = partnerOf(seat);
  for (const entry of state.bidding.history) {
    if (entry.seat === partner && entry.option !== 'pass') {
      return entry.option as BidAmount;
    }
  }
  return null;
}
