import { Card, Rank, Suit, isAceOfHearts, isRedSuit } from './cards';

const PIP: Record<Rank, number> = {
  A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
};

/**
 * Returns a comparable trump strength for a card given the trump suit.
 * Higher number wins. Returns null if the card is not a trump.
 *
 * Order (highest to lowest):
 *   5 of trump > J of trump > Ace of Hearts > Ace of trump > K of trump > Q of trump
 *   then trump pip cards: red trump = highest pip wins; black trump = lowest pip wins.
 *
 * Ace of Hearts is always a trump. When trump is Hearts, AH simply occupies its
 * single slot at rank 98 (the trump-A position collapses with AH).
 */
export function trumpPower(card: Card, trump: Suit): number | null {
  const isTrumpSuit = card.suit === trump;
  const isAH = isAceOfHearts(card);

  if (!isTrumpSuit && !isAH) return null;

  if (isTrumpSuit && card.rank === '5') return 100;
  if (isTrumpSuit && card.rank === 'J') return 99;
  if (isAH) return 98;
  if (isTrumpSuit && card.rank === 'A') return 97; // unreachable when hearts is trump (handled above)
  if (isTrumpSuit && card.rank === 'K') return 96;
  if (isTrumpSuit && card.rank === 'Q') return 95;

  // Remaining trump pip cards.
  const pip = PIP[card.rank];
  // Red trump: higher pip is better. Use pip directly (max 10 for non-A/K/Q/J/5).
  // Black trump: lower pip is better. Invert.
  if (isRedSuit(trump)) return pip; // 10..2 → 10..2, well under 95
  // black: 2..10 mapped to higher score, but never exceeding 12 (= 14 - 2).
  return 14 - pip; // 2 -> 12, 3 -> 11, 4 -> 10, 6 -> 8, 7 -> 7, 8 -> 6, 9 -> 5, 10 -> 4
}

/**
 * Comparable strength for a non-trump card when comparing within the led suit.
 * Returns -1 if the card does not match the led suit (cannot win the trick).
 *
 * Red non-trumps:   A K Q J 10 9 8 7 6 5 4 3 2
 * Black non-trumps: A K Q J 2 3 4 5 6 7 8 9 10  (lower pip is better below J)
 */
export function nonTrumpPower(card: Card, ledSuit: Suit): number {
  if (card.suit !== ledSuit) return -1;
  switch (card.rank) {
    case 'A': return 13;
    case 'K': return 12;
    case 'Q': return 11;
    case 'J': return 10;
    default: break;
  }
  const pip = PIP[card.rank]; // 2..10
  return isRedSuit(ledSuit) ? pip - 1 : 11 - pip; // red: 10->9..2->1; black: 2->9..10->1
}

export function isTrump(card: Card, trump: Suit): boolean {
  return trumpPower(card, trump) !== null;
}

/**
 * Determine the index of the winning play in a trick.
 * `plays` is an array of cards in the order they were played.
 * `ledSuit` is the suit of the first card actually played.
 */
export function trickWinnerIndex(plays: Card[], trump: Suit): number {
  if (plays.length === 0) throw new Error('trickWinnerIndex: empty trick');
  const ledSuit = plays[0]!.suit;
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < plays.length; i++) {
    const c = plays[i]!;
    const tp = trumpPower(c, trump);
    const score = tp !== null ? 1000 + tp : nonTrumpPower(c, ledSuit);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** The renege-eligible trumps, in descending strength. */
export function isRenegeEligible(card: Card, trump: Suit): boolean {
  if (card.suit === trump && card.rank === '5') return true;
  if (card.suit === trump && card.rank === 'J') return true;
  if (isAceOfHearts(card)) return true;
  return false;
}

/**
 * Across an entire hand of tricks, find the play with the highest trump.
 * Returns null if no trumps were played all hand. The "best trump" earns
 * a +5 bonus to its team.
 */
export function bestTrumpPlayer(
  trickPlays: { plays: { seat: number; card: Card }[] }[],
  trump: Suit,
): { seat: number; card: Card } | null {
  let best: { seat: number; card: Card } | null = null;
  let bestScore = -Infinity;
  for (const t of trickPlays) {
    for (const p of t.plays) {
      const tp = trumpPower(p.card, trump);
      if (tp !== null && tp > bestScore) {
        bestScore = tp;
        best = p;
      }
    }
  }
  return best;
}
