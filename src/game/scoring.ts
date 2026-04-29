import { Suit } from './cards';
import { bestTrumpPlayer } from './ranking';
import { BidAmount, GameState, Seat, Team, Trick, teamOf } from './state';

export type HandResult = {
  pointsByTeam: [number, number];
  bidMade: boolean;
  bestTrumpSeat: Seat | null;
  trickPointsByTeam: [number, number];
  bonusByTeam: [number, number];
};

/**
 * Compute the per-hand result given completed tricks, trump, and contract.
 * `pointsByTeam` is the value to ADD to each team's running score (can be negative).
 */
export function scoreHand(
  tricks: Trick[],
  trump: Suit,
  contract: { bidder: Seat; amount: BidAmount },
): HandResult {
  const trickPoints: [number, number] = [0, 0];
  for (const t of tricks) {
    if (t.winner === undefined) continue;
    trickPoints[teamOf(t.winner)] += 5;
  }

  const best = bestTrumpPlayer(tricks, trump);
  const bonus: [number, number] = [0, 0];
  if (best !== null) bonus[teamOf(best.seat as Seat)] += 5;

  const earned: [number, number] = [
    trickPoints[0] + bonus[0],
    trickPoints[1] + bonus[1],
  ];

  const bidderTeam: Team = teamOf(contract.bidder);
  const otherTeam: Team = bidderTeam === 0 ? 1 : 0;

  let final: [number, number] = [0, 0];
  let bidMade = false;

  if (contract.amount === 30) {
    // 30 for 60: must win all 5 tricks (= 30 points earned).
    bidMade = earned[bidderTeam] === 30;
    if (bidMade) {
      final[bidderTeam] = 60;
      final[otherTeam] = 0;
    } else {
      final[bidderTeam] = -30;
      final[otherTeam] = earned[otherTeam];
    }
  } else {
    // 20 or 25: bidder team must reach the bid amount in earned points.
    bidMade = earned[bidderTeam] >= contract.amount;
    if (bidMade) {
      final[bidderTeam] = earned[bidderTeam];
      final[otherTeam] = earned[otherTeam];
    } else {
      final[bidderTeam] = -contract.amount;
      final[otherTeam] = earned[otherTeam];
    }
  }

  return {
    pointsByTeam: final,
    bidMade,
    bestTrumpSeat: best ? (best.seat as Seat) : null,
    trickPointsByTeam: trickPoints,
    bonusByTeam: bonus,
  };
}

/**
 * Apply the "must bid to win" rule at score >= 100. If a defending team would
 * cross 120 from earned tricks alone, their score is capped at 119 instead.
 *
 * If the in-hole variant is enabled and any opposing team is below 0, the cap
 * is waived.
 */
export function applyEndgameRule(
  current: [number, number],
  delta: [number, number],
  contract: { bidder: Seat; amount: BidAmount } | null,
  inHoleVariant: boolean,
): [number, number] {
  const next: [number, number] = [current[0] + delta[0], current[1] + delta[1]];

  if (!contract) return next;

  for (const team of [0, 1] as const) {
    if (current[team] < 100) continue; // rule only applies at 100+
    if (next[team] < 120) continue; // not crossing 120 anyway

    const isBidderTeam = teamOf(contract.bidder) === team;
    if (isBidderTeam) continue; // crossed via successful bid -> ok

    // Defending team would cross 120 via tricks alone. Apply cap unless waived.
    const otherTeam = team === 0 ? 1 : 0;
    if (inHoleVariant && next[otherTeam] < 0) continue; // variant waives

    next[team] = 119;
  }

  return next;
}

export function isGameOver(score: [number, number]): boolean {
  return score[0] >= 120 || score[1] >= 120;
}

export function gameWinner(score: [number, number]): Team | null {
  if (score[0] >= 120 && score[0] > score[1]) return 0;
  if (score[1] >= 120 && score[1] > score[0]) return 1;
  return null;
}

/** Convenience: also handles in-hole rule for an existing GameState. */
export function applyHandResultToState(state: GameState, result: HandResult): [number, number] {
  return applyEndgameRule(
    state.totalScore,
    result.pointsByTeam,
    state.contract,
    state.settings.inHoleVariant,
  );
}
