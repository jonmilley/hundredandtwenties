import { describe, it, expect } from 'vitest';
import { startBidding, submitBid, biddingResolution, legalBidOptions } from '../src/game/bidding';
describe('bidding', () => {
    const dealer = 3;
    it('must bid if hand has a 5 and no current bid', () => {
        const b = startBidding(dealer);
        const handWithFive = [{ rank: '5', suit: 'H' }, { rank: 'K', suit: 'C' }];
        const options = legalBidOptions(b, dealer, handWithFive);
        expect(options).not.toContain('pass');
        expect(options).toContain(20);
        expect(() => submitBid(b, 0, 'pass', dealer, handWithFive)).toThrow('Illegal bid option');
    });
    it('can pass with a 5 if there is already a bid', () => {
        let b = startBidding(dealer);
        b = submitBid(b, 0, 20, dealer).state; // seat 0 bids 20
        const handWithFive = [{ rank: '5', suit: 'D' }];
        const options = legalBidOptions(b, dealer, handWithFive);
        expect(options).toContain('pass'); // legal because standing bid is 20
        expect(() => submitBid(b, 1, 'pass', dealer, handWithFive)).not.toThrow();
    });
    it('all pass -> dealer stuck with 20', () => {
        let b = startBidding(dealer);
        for (const s of [0, 1, 2, 3]) {
            const r = submitBid(b, s, 'pass', dealer);
            b = r.state;
        }
        expect(b.done).toBe(true);
        const res = biddingResolution(b);
        expect(res?.bidder).toBe(3);
        expect(res?.amount).toBe(20);
    });
    it('seat 0 bids 20, others pass, dealer passes -> seat 0 wins at 20', () => {
        let b = startBidding(dealer);
        b = submitBid(b, 0, 20, dealer).state;
        b = submitBid(b, 1, 'pass', dealer).state;
        b = submitBid(b, 2, 'pass', dealer).state;
        b = submitBid(b, 3, 'pass', dealer).state;
        expect(biddingResolution(b)).toEqual({ bidder: 0, amount: 20 });
    });
    it('dealer can take and player passes -> dealer wins', () => {
        let b = startBidding(dealer);
        b = submitBid(b, 0, 25, dealer).state;
        b = submitBid(b, 1, 'pass', dealer).state;
        b = submitBid(b, 2, 'pass', dealer).state;
        // Dealer takes 25
        b = submitBid(b, 3, 25, dealer).state;
        // Cursor now back at seat 0; they pass to accept dealer's take.
        b = submitBid(b, 0, 'pass', dealer).state;
        expect(biddingResolution(b)).toEqual({ bidder: 3, amount: 25 });
    });
    it('dealer takes, player raises, dealer takes again -> dealer wins at higher', () => {
        let b = startBidding(dealer);
        b = submitBid(b, 0, 20, dealer).state;
        b = submitBid(b, 1, 'pass', dealer).state;
        b = submitBid(b, 2, 'pass', dealer).state;
        b = submitBid(b, 3, 20, dealer).state; // dealer takes
        b = submitBid(b, 0, 25, dealer).state; // player raises
        b = submitBid(b, 3, 25, dealer).state; // dealer takes again
        b = submitBid(b, 0, 'pass', dealer).state; // player accepts
        expect(biddingResolution(b)).toEqual({ bidder: 3, amount: 25 });
    });
    it('non-dealer bids 30, dealer can pass -> non-dealer wins', () => {
        let b = startBidding(dealer);
        b = submitBid(b, 0, 30, dealer).state;
        // Cursor jumps to dealer.
        b = submitBid(b, 3, 'pass', dealer).state;
        expect(biddingResolution(b)).toEqual({ bidder: 0, amount: 30 });
    });
    it('non-dealer bids 30, dealer takes -> dealer wins at 30', () => {
        let b = startBidding(dealer);
        b = submitBid(b, 0, 30, dealer).state;
        b = submitBid(b, 3, 30, dealer).state; // dealer takes 30
        expect(biddingResolution(b)).toEqual({ bidder: 3, amount: 30 });
    });
});
