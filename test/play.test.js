import { describe, it, expect } from 'vitest';
import { legalPlayIndices } from '../src/game/play';
const c = (rank, suit) => ({ rank, suit });
describe('legalPlayIndices', () => {
    const trump = 'D';
    it('any card legal when leading', () => {
        const hand = [c('A', 'C'), c('5', 'D'), c('K', 'S')];
        expect(legalPlayIndices(hand, [], trump).length).toBe(3);
    });
    it('any card legal when non-trump led', () => {
        const hand = [c('A', 'C'), c('5', 'D'), c('K', 'S')];
        const trick = [c('K', 'C')];
        expect(legalPlayIndices(hand, trick, trump).length).toBe(3);
    });
    it('must follow trump when trump led and holding non-renegeable trump', () => {
        const hand = [c('A', 'C'), c('Q', 'D'), c('K', 'S')];
        const trick = [c('2', 'D')]; // 2D is a trump pip (red trump = high pip rules)
        const legal = legalPlayIndices(hand, trick, trump);
        // Only the trump (Q of D, index 1) is legal.
        expect(legal).toEqual([1]);
    });
    it('5T may renege when only a low trump is led', () => {
        const hand = [c('A', 'C'), c('5', 'D'), c('K', 'S')];
        const trick = [c('2', 'D')];
        const legal = legalPlayIndices(hand, trick, trump);
        // 5D is renege-eligible vs 2D; player has no other trump; any card legal.
        expect(legal.length).toBe(3);
    });
    it('JT forced when 5T already on table', () => {
        const hand = [c('A', 'C'), c('J', 'D'), c('K', 'S')];
        const trick = [c('5', 'D')];
        const legal = legalPlayIndices(hand, trick, trump);
        expect(legal).toEqual([1]); // must play JD
    });
    it('AH may renege vs any trump up to JT', () => {
        const trumpC = 'C';
        const hand = [c('A', 'H'), c('Q', 'D'), c('K', 'S')];
        const trick = [c('2', 'C')]; // black trump pip; AH outranks
        const legal = legalPlayIndices(hand, trick, trumpC);
        // AH is renege-eligible; nothing on table outranks AH (AH = 98, 2C trump power = 12)
        // Player has only one trump (AH), and it's renegeable -> any card legal.
        expect(legal.length).toBe(3);
    });
    it('AH forced when 5T or JT on table', () => {
        const trumpC = 'C';
        const hand = [c('A', 'H'), c('Q', 'D'), c('K', 'S')];
        const trick = [c('5', 'C')];
        const legal = legalPlayIndices(hand, trick, trumpC);
        expect(legal).toEqual([0]); // must play AH
    });
    it('player with no trump can play anything when trump is led', () => {
        const hand = [c('A', 'C'), c('K', 'S'), c('Q', 'H')];
        const trick = [c('2', 'D')];
        const legal = legalPlayIndices(hand, trick, trump);
        expect(legal.length).toBe(3);
    });
    it('renegeable + non-renegeable in hand: must play any trump', () => {
        const hand = [c('5', 'D'), c('Q', 'D'), c('K', 'S')];
        const trick = [c('2', 'D')];
        const legal = legalPlayIndices(hand, trick, trump);
        // QD is forced (non-renegeable). Player must play a trump but may pick 5D OR QD.
        expect(legal.sort()).toEqual([0, 1]);
    });
});
