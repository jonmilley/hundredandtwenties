import './style.css';
import { dealHand, discardAndDraw, getLegalBidOptions, makeInitialState, playCard, resolveScorePhase, setTrumpAndTakeKitty, submitBidAction, chooseNormalKitty, chooseOneCardKitty, finalizeOneCardKittyKeep, } from './game/flow';
import { HUMAN_SEAT, loadState, saveState, clearSavedState, } from './game/state';
import { aiBid, aiBidderDiscard, aiNonBidderDiscard, aiPickCard, pickBestTrump, } from './ai/index';
import { Renderer } from './ui/render';
const AI_BID_DELAY_MS = 850;
const AI_CARD_DELAY_MS = 800;
const AI_DISCARD_DELAY_MS = 500;
const TRICK_WINNER_PAUSE_MS = 1300;
const appEl = document.getElementById('app');
let state = loadState() || makeInitialState(Date.now());
let pendingTrump = null;
/** Read phase fresh (avoids TS narrowing sticking after mutations). */
const ph = () => state.phase;
/** Wrap renderer.render to also persist state. */
const render = (options = {}) => {
    saveState(state);
    renderer.render(state, options);
};
const callbacks = {
    onCardClick(seat, idx) {
        if (ph() !== 'play' || state.toAct !== HUMAN_SEAT)
            return;
        const card = state.hands[HUMAN_SEAT][idx];
        if (!card)
            return;
        const tricksBefore = state.completedTricks.length;
        try {
            playCard(state, seat, card);
        }
        catch (err) {
            renderer.showToast(String(err));
            return;
        }
        const trickJustCompleted = state.completedTricks.length > tricksBefore;
        const winner = trickJustCompleted
            ? state.completedTricks[state.completedTricks.length - 1].winner
            : undefined;
        render({ trickWinner: winner });
        if (trickJustCompleted && ph() === 'play') {
            // Pause to show the trick winner, then let AI lead (skipping its initial delay).
            setTimeout(() => { if (ph() === 'play')
                scheduleAIPlay(true); }, TRICK_WINNER_PAUSE_MS);
        }
        else if (ph() === 'play') {
            scheduleAIPlay();
        }
    },
    onBidClick(option) {
        if (ph() !== 'bid' || !state.bidding)
            return;
        const legal = getLegalBidOptions(state);
        if (!legal.includes(option))
            return;
        submitBidAction(state, HUMAN_SEAT, option);
        render();
        if (ph() === 'bid_on_kitty') {
            if (state.contract?.bidder !== HUMAN_SEAT)
                scheduleAIBidOnKitty();
        }
        else if (ph() === 'bid') {
            scheduleAIBid();
        }
    },
    onKittyOptionClick(option) {
        if (ph() !== 'bid_on_kitty')
            return;
        if (option === 'normal') {
            chooseNormalKitty(state);
        }
        else {
            chooseOneCardKitty(state);
        }
        render();
    },
    onKittyKeepClick(idx) {
        if (ph() !== 'bid_on_kitty' || !state.bidOnKitty)
            return;
        finalizeOneCardKittyKeep(state, idx);
        render();
        if (ph() === 'kitty' && state.contract?.bidder !== HUMAN_SEAT)
            scheduleAIKitty();
    },
    onTrumpClick(suit) {
        if (ph() !== 'kitty')
            return;
        pendingTrump = suit;
        renderer.showTrumpSelectedKittyModal(state, suit);
    },
    onKittyConfirm(discards) {
        if (!pendingTrump || ph() !== 'kitty')
            return;
        setTrumpAndTakeKitty(state, pendingTrump, discards);
        pendingTrump = null;
        render();
        if (ph() === 'discard')
            scheduleAIDiscard();
    },
    onDiscardConfirm(seat, discards) {
        if (ph() !== 'discard')
            return;
        discardAndDraw(state, seat, discards);
        render();
        if (ph() === 'discard')
            scheduleAIDiscard();
        else if (ph() === 'play')
            scheduleAIPlay();
    },
    onDealClick() {
        if (ph() === 'gameOver') {
            state = makeInitialState(Date.now());
        }
        dealHand(state);
        render({ dealAnimation: true });
        scheduleAIBid();
    },
    onScoreClose() {
        if (ph() !== 'score')
            return;
        resolveScorePhase(state);
        render();
    },
    onIntroClose() {
        if (ph() !== 'intro')
            return;
        state.phase = 'deal';
        render();
    },
    onRestart() {
        clearSavedState();
        window.location.reload();
    },
};
const renderer = new Renderer(appEl, callbacks);
render();
// Resume AI if it's their turn on load
function resumeAI() {
    if (ph() === 'bid')
        scheduleAIBid();
    else if (ph() === 'bid_on_kitty' && state.contract?.bidder !== HUMAN_SEAT)
        scheduleAIBidOnKitty();
    else if (ph() === 'kitty' && state.contract?.bidder !== HUMAN_SEAT)
        scheduleAIKitty();
    else if (ph() === 'discard' && state.discardQueue[0] !== HUMAN_SEAT && state.discardQueue.length > 0)
        scheduleAIDiscard();
    else if (ph() === 'play' && state.toAct !== HUMAN_SEAT && state.toAct !== null)
        scheduleAIPlay();
}
resumeAI();
// ---- AI turn scheduling ----
function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function scheduleAIBid() {
    while (ph() === 'bid' && state.bidding && !state.bidding.done) {
        const bidder = state.bidding.order[state.bidding.cursor];
        if (bidder === undefined || bidder === HUMAN_SEAT)
            break;
        await delay(AI_BID_DELAY_MS);
        if (ph() !== 'bid')
            break;
        const option = aiBid(state, bidder);
        submitBidAction(state, bidder, option);
        render();
    }
    if (ph() === 'bid_on_kitty' && state.contract) {
        if (state.contract.bidder !== HUMAN_SEAT)
            scheduleAIBidOnKitty();
    }
}
async function scheduleAIBidOnKitty() {
    await delay(AI_BID_DELAY_MS);
    if (ph() !== 'bid_on_kitty' || !state.contract)
        return;
    const bidder = state.contract.bidder;
    if (bidder === HUMAN_SEAT)
        return;
    // AI always picks normal for now
    chooseNormalKitty(state);
    render();
    if (ph() === 'kitty')
        scheduleAIKitty();
}
async function scheduleAIKitty() {
    await delay(AI_BID_DELAY_MS);
    if (ph() !== 'kitty' || !state.contract)
        return;
    const bidder = state.contract.bidder;
    if (bidder === HUMAN_SEAT)
        return;
    const { suit } = pickBestTrump(state.hands[bidder]);
    const discards = aiBidderDiscard(state.hands[bidder], state.kitty, suit);
    setTrumpAndTakeKitty(state, suit, discards);
    render();
    if (ph() === 'discard')
        scheduleAIDiscard();
    else if (ph() === 'play')
        scheduleAIPlay();
}
async function scheduleAIDiscard() {
    while (ph() === 'discard' && state.discardQueue.length > 0) {
        const seat = state.discardQueue[0];
        if (seat === HUMAN_SEAT)
            break;
        await delay(AI_DISCARD_DELAY_MS);
        if (ph() !== 'discard')
            break;
        const discards = aiNonBidderDiscard(state.hands[seat], state.trump);
        discardAndDraw(state, seat, discards);
        render();
    }
    if (ph() === 'play')
        scheduleAIPlay();
}
async function scheduleAIPlay(skipInitialDelay = false) {
    let skipDelay = skipInitialDelay;
    while (ph() === 'play' && state.toAct !== null) {
        const seat = state.toAct;
        if (seat === HUMAN_SEAT)
            break;
        if (!skipDelay)
            await delay(AI_CARD_DELAY_MS);
        skipDelay = false;
        if (ph() !== 'play' || state.toAct !== seat)
            break;
        const tricksBefore = state.completedTricks.length;
        const card = aiPickCard(state, seat);
        playCard(state, seat, card);
        const trickJustCompleted = state.completedTricks.length > tricksBefore;
        const winner = trickJustCompleted
            ? state.completedTricks[state.completedTricks.length - 1].winner
            : undefined;
        render({ trickWinner: winner });
        if (trickJustCompleted && ph() === 'play') {
            await delay(TRICK_WINNER_PAUSE_MS);
            skipDelay = true; // The pause IS the gap; don't add another delay before the lead.
        }
    }
}
