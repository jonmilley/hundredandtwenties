import { isTrump, trumpPower } from './ranking';
/**
 * Returns the indices of cards in `hand` that are legal to play given the
 * trick-so-far and trump.
 *
 * Rules (v1, per user spec):
 *   - If no card has been led yet (player is leading the trick): all cards legal.
 *   - If a non-trump was led: any card legal (no must-follow-suit).
 *   - If a trump was led: must play a trump if possible, EXCEPT renege-eligible
 *     trumps (5 of trump, J of trump, AH) may be withheld unless a higher
 *     trump is already on the table.
 */
export function legalPlayIndices(hand, trick, trump) {
    if (trick.length === 0) {
        return hand.map((_, i) => i);
    }
    const ledCard = trick[0];
    const ledIsTrump = isTrump(ledCard, trump);
    if (!ledIsTrump) {
        return hand.map((_, i) => i);
    }
    // Trump was led. Determine the highest trump on the table.
    let highestOnTable = -Infinity;
    for (const c of trick) {
        const tp = trumpPower(c, trump);
        if (tp !== null && tp > highestOnTable)
            highestOnTable = tp;
    }
    // Player must play a trump if any in hand, but renege-eligible cards
    // (5T, JT, AH) may be retained unless a strictly-higher trump is on the
    // table.
    // Renege thresholds (in trump power):
    //   5T = 100, JT = 99, AH = 98.
    // A renege-eligible card is "forced" only when the highest trump on the
    // table is strictly greater than that card's own trump power.
    const hasAnyTrump = hand.some((c) => isTrump(c, trump));
    if (!hasAnyTrump) {
        // No trumps; any card may be played.
        return hand.map((_, i) => i);
    }
    // Identify which trump cards in hand are forced to be played.
    const forced = [];
    for (let i = 0; i < hand.length; i++) {
        const c = hand[i];
        const tp = trumpPower(c, trump);
        if (tp === null)
            continue; // non-trump
        const renegeable = tp >= 98; // 5T, JT, AH
        if (!renegeable) {
            forced.push(i);
            continue;
        }
        // Renege-eligible: only forced if a strictly-higher trump is on the table.
        if (highestOnTable > tp)
            forced.push(i);
    }
    if (forced.length > 0) {
        // Player must play a trump, but may pick from forced trumps OR any
        // trump that they hold (the forcing only restricts vs non-trumps in hand).
        // Wait — if they have a non-renegeable trump, they MUST play a trump
        // (cannot play a non-trump). They can pick any of their trumps,
        // including renegeable ones, since playing a higher card is allowed.
        return hand
            .map((c, i) => ({ c, i }))
            .filter((x) => isTrump(x.c, trump))
            .map((x) => x.i);
    }
    // All trumps in hand are renegeable AND none forced -> any card is legal.
    return hand.map((_, i) => i);
}
export function isLegalPlay(hand, trick, trump, cardIndex) {
    return legalPlayIndices(hand, trick, trump).includes(cardIndex);
}
