import { SUIT_GLYPHS, SUIT_LABELS, isRedSuit } from '../game/cards';
import { legalBidOptions } from '../game/bidding';
import { scoreHand, applyEndgameRule } from '../game/scoring';
import { HUMAN_SEAT, teamOf } from '../game/state';
import { legalPlayIndices } from '../game/play';
const SEAT_NAMES = { 0: 'You', 1: 'West', 2: 'North', 3: 'East' };
const SEAT_DIR = { 0: 'south', 1: 'west', 2: 'north', 3: 'east' };
const TRICK_SLOT = { 0: 's', 1: 'w', 2: 'n', 3: 'e' };
export class Renderer {
    root;
    cb;
    toastTimer = null;
    discardSelected = new Set();
    constructor(root, cb) {
        this.root = root;
        this.cb = cb;
    }
    render(state, options = {}) {
        // Clear discard selection whenever it's no longer the human's turn to discard.
        if (state.phase !== 'discard' || state.discardQueue[0] !== HUMAN_SEAT) {
            this.discardSelected.clear();
        }
        this.root.innerHTML = '';
        const app = this.root;
        const table = el('div', 'table');
        app.appendChild(table);
        const dealCounter = { n: 0 };
        // North seat (partner, seat 2)
        table.appendChild(this.renderSeat(state, 2, options, dealCounter));
        // West seat (opponent, seat 1)
        table.appendChild(this.renderSeat(state, 1, options, dealCounter));
        // Center trick area
        table.appendChild(this.renderCenter(state, options));
        // East seat (opponent, seat 3)
        table.appendChild(this.renderSeat(state, 3, options, dealCounter));
        // South seat (human, seat 0)
        table.appendChild(this.renderSeat(state, 0, options, dealCounter));
        // Side panel
        app.appendChild(this.renderPanel(state));
        // Overlays
        if (state.phase === 'intro') {
            app.appendChild(this.renderIntroModal());
        }
        if (state.phase === 'kitty') {
            app.appendChild(this.renderKittyModal(state));
        }
        if (state.phase === 'score') {
            app.appendChild(this.renderScoreModal(state));
        }
        if (state.phase === 'gameOver') {
            app.appendChild(this.renderGameOverModal(state));
        }
    }
    renderSeat(state, seat, options, dealCounter) {
        const dir = SEAT_DIR[seat];
        const div = el('div', `seat seat--${dir}`);
        // Label row
        const label = el('div', 'seat__label');
        const nameEl = el('span', 'seat__name');
        nameEl.textContent = SEAT_NAMES[seat];
        if (state.toAct === seat || (state.bidding && state.bidding.order[state.bidding.cursor] === seat)) {
            nameEl.classList.add('is-acting');
        }
        label.appendChild(nameEl);
        if (state.dealer === seat) {
            const chip = el('span', 'dealer-chip');
            chip.textContent = 'D';
            label.appendChild(chip);
        }
        if (state.phase === 'bid' && state.bidding) {
            const lastAction = [...state.bidding.history].reverse().find(e => e.seat === seat);
            if (lastAction) {
                const chip = el('span', lastAction.option === 'pass' ? 'bid-chip bid-chip--pass' : 'bid-chip');
                chip.textContent = lastAction.option === 'pass' ? 'Pass' : String(lastAction.option);
                label.appendChild(chip);
            }
        }
        if (state.contract?.bidder === seat && state.phase !== 'deal') {
            const chip = el('span', 'bid-chip');
            chip.textContent = `Bid ${state.contract.amount}`;
            label.appendChild(chip);
        }
        div.appendChild(label);
        // Hand of cards
        const hand = el('div', `hand hand--${dir}`);
        const cards = state.hands[seat];
        // Legal indices (only matter for human in play phase)
        let legalSet = new Set();
        if (seat === HUMAN_SEAT &&
            state.phase === 'play' &&
            state.toAct === HUMAN_SEAT &&
            state.trump &&
            state.currentTrick) {
            const trick = state.currentTrick.plays.map((p) => p.card);
            legalPlayIndices(cards, trick, state.trump).forEach((i) => legalSet.add(i));
        }
        if (seat !== HUMAN_SEAT || state.phase === 'deal' || state.phase === 'gameOver') {
            // Show face-down for all AI seats; also during some phases
            const count = cards.length;
            for (let i = 0; i < count; i++) {
                const cardEl = cardBack();
                if (options.dealAnimation) {
                    cardEl.classList.add('card--deal');
                    cardEl.style.setProperty('--deal-delay', `${dealCounter.n * 40}ms`);
                }
                dealCounter.n++;
                hand.appendChild(cardEl);
            }
        }
        else {
            // Human hand: show face-up
            for (let i = 0; i < cards.length; i++) {
                const c = cards[i];
                const cardEl = cardFace(c);
                if (options.dealAnimation) {
                    cardEl.classList.add('card--deal');
                    cardEl.style.setProperty('--deal-delay', `${dealCounter.n * 40}ms`);
                }
                dealCounter.n++;
                if (state.phase === 'play' && state.toAct === HUMAN_SEAT) {
                    const isLegal = legalSet.has(i);
                    cardEl.classList.add(isLegal ? 'is-legal' : 'is-illegal');
                    if (isLegal) {
                        const idx = i;
                        cardEl.addEventListener('click', () => this.cb.onCardClick(HUMAN_SEAT, idx));
                    }
                }
                else if (state.phase === 'discard' && state.discardQueue[0] === HUMAN_SEAT) {
                    cardEl.classList.add('is-legal');
                    const idx = i;
                    if (this.discardSelected.has(idx))
                        cardEl.classList.add('is-selected');
                    cardEl.addEventListener('click', () => {
                        if (this.discardSelected.has(idx))
                            this.discardSelected.delete(idx);
                        else
                            this.discardSelected.add(idx);
                        this.render(state, options);
                    });
                }
                else if (state.phase !== 'score') {
                    cardEl.classList.add('is-legal');
                }
                hand.appendChild(cardEl);
            }
        }
        div.appendChild(hand);
        return div;
    }
    renderCenter(state, options) {
        const center = el('div', 'center');
        // Active trick cards (in progress)
        if (state.currentTrick && state.currentTrick.plays.length > 0) {
            for (const play of state.currentTrick.plays) {
                const slot = el('div', `trick-slot trick-slot--${TRICK_SLOT[play.seat]}`);
                slot.appendChild(cardFace(play.card));
                center.appendChild(slot);
            }
        }
        // Last completed trick — show when current trick is empty (just resolved) or null during score.
        const currentEmpty = !state.currentTrick || state.currentTrick.plays.length === 0;
        if (currentEmpty && state.completedTricks.length > 0 && (state.phase === 'play' || state.phase === 'score')) {
            const last = state.completedTricks[state.completedTricks.length - 1];
            for (const play of last.plays) {
                const slot = el('div', `trick-slot trick-slot--${TRICK_SLOT[play.seat]}`);
                const cardEl = cardFace(play.card);
                if (last.winner !== undefined && play.seat === last.winner) {
                    cardEl.classList.add('is-trick-winner');
                }
                slot.appendChild(cardEl);
                center.appendChild(slot);
            }
        }
        // Hub
        const hub = el('div', 'trick-slot trick-slot--hub');
        const hubInner = el('div', 'hub');
        if (options.trickWinner !== undefined) {
            const winnerEl = el('span', 'hub__winner');
            winnerEl.textContent = `${SEAT_NAMES[options.trickWinner]} wins!`;
            hubInner.appendChild(winnerEl);
        }
        const phase = el('span', 'hub__phase');
        phase.textContent = phaseLabel(state);
        hubInner.appendChild(phase);
        if (state.trump) {
            const trumpEl = el('span', 'hub__trump');
            trumpEl.textContent = SUIT_GLYPHS[state.trump];
            trumpEl.classList.add(isRedSuit(state.trump) ? 'is-red' : 'is-black');
            hubInner.appendChild(trumpEl);
        }
        hub.appendChild(hubInner);
        center.appendChild(hub);
        return center;
    }
    renderPanel(state) {
        const panel = el('div', 'panel');
        // Score
        const scoreTitle = el('div', 'panel__title');
        scoreTitle.textContent = 'Score';
        panel.appendChild(scoreTitle);
        const scoreboard = el('div', 'scoreboard');
        const teamLabels = ['You & North', 'West & East'];
        for (let t = 0; t < 2; t++) {
            const sc = el('div', `score-card${t === 0 ? ' is-yours' : ''}`);
            const lbl = el('div', 'score-card__label');
            lbl.textContent = teamLabels[t];
            const val = el('div', 'score-card__value');
            val.textContent = String(state.totalScore[t]);
            sc.appendChild(lbl);
            sc.appendChild(val);
            scoreboard.appendChild(sc);
        }
        panel.appendChild(scoreboard);
        // Action section
        const section = el('div', 'action-section');
        const sectionTitle = el('div', 'action-section__title');
        section.appendChild(sectionTitle);
        if (state.phase === 'deal') {
            sectionTitle.textContent = 'Ready';
            const btn = el('button', 'btn is-primary');
            btn.textContent = state.handsPlayed === 0 ? 'Start Game' : 'Deal Next Hand';
            btn.addEventListener('click', () => this.cb.onDealClick());
            section.appendChild(btn);
        }
        else if (state.phase === 'bid' && state.bidding && !state.bidding.done) {
            const currentBidder = state.bidding.order[state.bidding.cursor];
            if (currentBidder === HUMAN_SEAT) {
                sectionTitle.textContent = 'Your Bid';
                const row = el('div', 'button-row');
                const isDealer = HUMAN_SEAT === state.dealer;
                const legalOpts = state.bidding ? legalBidOptions(state.bidding, state.dealer) : [];
                for (const opt of legalOpts) {
                    const btn = el('button', 'btn');
                    if (opt === 'pass') {
                        btn.textContent = 'Pass';
                    }
                    else if (isDealer && opt === state.bidding.highBid) {
                        btn.textContent = `Take ${opt}`;
                        btn.classList.add('is-primary');
                    }
                    else {
                        btn.textContent = `Bid ${opt}`;
                        if (opt === 30)
                            btn.classList.add('is-primary');
                    }
                    btn.addEventListener('click', () => this.cb.onBidClick(opt));
                    row.appendChild(btn);
                }
                section.appendChild(row);
            }
            else {
                sectionTitle.textContent = `${SEAT_NAMES[currentBidder]} is bidding…`;
            }
        }
        else if (state.phase === 'kitty') {
            sectionTitle.textContent = 'Pick Trump';
        }
        else if (state.phase === 'discard') {
            if (state.discardQueue[0] === HUMAN_SEAT) {
                const n = this.discardSelected.size;
                sectionTitle.textContent = 'Discard';
                const hint = el('div', '');
                hint.style.fontSize = '12px';
                hint.style.color = 'var(--muted)';
                hint.textContent = n === 0
                    ? 'Click cards in your hand to select them for discard.'
                    : `${n} card${n !== 1 ? 's' : ''} selected`;
                section.appendChild(hint);
                const btn = el('button', 'btn is-primary');
                btn.textContent = n === 0 ? 'Keep All (no discard)' : `Discard ${n} card${n !== 1 ? 's' : ''}`;
                btn.addEventListener('click', () => {
                    const discards = [...this.discardSelected].map(i => state.hands[HUMAN_SEAT][i]);
                    this.discardSelected.clear();
                    this.cb.onDiscardConfirm(HUMAN_SEAT, discards);
                });
                section.appendChild(btn);
            }
            else {
                sectionTitle.textContent = `${SEAT_NAMES[state.discardQueue[0]]} discarding…`;
            }
        }
        else if (state.phase === 'play') {
            if (state.toAct === HUMAN_SEAT) {
                sectionTitle.textContent = 'Your Turn — Play a Card';
            }
            else if (state.toAct !== null) {
                sectionTitle.textContent = `${SEAT_NAMES[state.toAct]} is playing…`;
            }
            else {
                sectionTitle.textContent = 'Trick complete';
            }
            // Show tricks won this hand
            const tricksInfo = el('div', '');
            tricksInfo.style.fontSize = '12px';
            tricksInfo.style.color = 'var(--muted)';
            const t0 = state.tricksWon[0];
            const t1 = state.tricksWon[1];
            tricksInfo.textContent = `Tricks — You/North: ${t0}  |  West/East: ${t1}`;
            section.appendChild(tricksInfo);
            if (state.contract) {
                const bidInfo = el('div', '');
                bidInfo.style.fontSize = '12px';
                bidInfo.style.color = 'var(--muted)';
                const bidderTeam = teamOf(state.contract.bidder);
                bidInfo.textContent = `Bid: ${state.contract.amount} by ${SEAT_NAMES[state.contract.bidder]} (Team ${bidderTeam === 0 ? 'You/N' : 'W/E'})`;
                section.appendChild(bidInfo);
            }
        }
        panel.appendChild(section);
        // Log
        const logTitle = el('div', 'panel__title');
        logTitle.textContent = 'Log';
        panel.appendChild(logTitle);
        const log = el('div', 'log');
        for (const entry of [...state.log].reverse().slice(0, 30)) {
            const row = el('div', 'log__entry');
            row.textContent = entry;
            log.appendChild(row);
        }
        panel.appendChild(log);
        return panel;
    }
    renderKittyModal(state) {
        if (!state.contract)
            return el('div', '');
        const modal = el('div', 'modal');
        const inner = el('div', 'modal__inner');
        const title = el('div', 'modal__title');
        title.textContent = 'Name Trump & Use Kitty';
        inner.appendChild(title);
        const hint = el('div', '');
        hint.style.fontSize = '13px';
        hint.style.color = 'var(--muted)';
        hint.textContent = `Kitty cards added to your hand (${state.kitty.length}). Choose trump, then discard at least ${state.kitty.length} — extra discards get replaced from the deck.`;
        inner.appendChild(hint);
        // Trump buttons
        const suitGrid = el('div', 'suit-grid');
        for (const suit of ['H', 'D', 'C', 'S']) {
            const btn = el('button', 'btn suit-btn');
            const glyph = el('span', `suit-glyph ${isRedSuit(suit) ? 'is-red' : 'is-black'}`);
            glyph.textContent = SUIT_GLYPHS[suit];
            const lbl = el('span', '');
            lbl.textContent = SUIT_LABELS[suit];
            btn.appendChild(glyph);
            btn.appendChild(lbl);
            btn.addEventListener('click', () => this.cb.onTrumpClick(suit));
            suitGrid.appendChild(btn);
        }
        inner.appendChild(suitGrid);
        modal.appendChild(inner);
        return modal;
    }
    renderTrumpSelectedKittyModal(state, trump) {
        if (!state.contract)
            return el('div', '');
        const modal = el('div', 'modal');
        const inner = el('div', 'modal__inner');
        const title = el('div', 'modal__title');
        title.textContent = `Trump: ${SUIT_GLYPHS[trump]} ${SUIT_LABELS[trump]} — Select Discards`;
        inner.appendChild(title);
        const combined = [...state.hands[state.contract.bidder], ...state.kitty];
        const minDiscard = combined.length - 5; // must discard at least kitty size (3)
        const selected = new Set();
        const hint = el('div', '');
        hint.style.fontSize = '13px';
        hint.style.color = 'var(--muted)';
        hint.textContent = `Discard at least ${minDiscard} cards — extras get replaced from the deck.`;
        inner.appendChild(hint);
        const status = el('div', '');
        status.style.fontSize = '12px';
        status.style.color = 'var(--muted)';
        status.style.marginTop = '4px';
        inner.appendChild(status);
        const handDiv = el('div', 'modal__hand');
        const confirmBtn = el('button', 'btn is-primary');
        confirmBtn.textContent = 'Confirm Discards';
        confirmBtn.disabled = true;
        const updateButtons = () => {
            const n = selected.size;
            const draws = n - minDiscard;
            confirmBtn.disabled = n < minDiscard;
            if (n === 0) {
                status.textContent = `Select at least ${minDiscard} cards`;
            }
            else if (draws > 0) {
                status.textContent = `Discarding ${n} — will draw ${draws} replacement${draws > 1 ? 's' : ''} from deck`;
            }
            else {
                status.textContent = `Discarding ${n}`;
            }
        };
        updateButtons();
        combined.forEach((c, i) => {
            const cardEl = cardFace(c);
            cardEl.addEventListener('click', () => {
                if (selected.has(i))
                    selected.delete(i);
                else
                    selected.add(i);
                cardEl.classList.toggle('is-selected', selected.has(i));
                updateButtons();
            });
            handDiv.appendChild(cardEl);
        });
        inner.appendChild(handDiv);
        confirmBtn.addEventListener('click', () => {
            const discards = [...selected].map((i) => combined[i]);
            this.cb.onKittyConfirm(discards);
        });
        inner.appendChild(confirmBtn);
        modal.appendChild(inner);
        return modal;
    }
    renderScoreModal(state) {
        const modal = el('div', 'modal');
        const inner = el('div', 'modal__inner');
        const title = el('div', 'modal__title');
        inner.appendChild(title);
        if (state.contract && state.trump) {
            // Compute the hand result here (pure, no mutation) so the modal shows
            // accurate points and the new running score.
            const result = scoreHand(state.completedTricks, state.trump, state.contract);
            const newScore = applyEndgameRule(state.totalScore, result.pointsByTeam, state.contract, state.settings.inHoleVariant);
            const bidMade = result.bidMade;
            title.textContent = bidMade ? 'Bid Made!' : 'Bid Failed';
            title.style.color = bidMade ? '#b8e0c4' : '#ff7780';
            const body = el('div', '');
            body.style.fontSize = '14px';
            body.style.color = 'var(--muted)';
            body.style.lineHeight = '1.8';
            const bidderName = SEAT_NAMES[state.contract.bidder];
            const ep0 = result.trickPointsByTeam[0] + result.bonusByTeam[0];
            const ep1 = result.trickPointsByTeam[1] + result.bonusByTeam[1];
            const bestSeat = result.bestTrumpSeat;
            const bestLabel = bestSeat !== null ? `${SEAT_NAMES[bestSeat]} held best trump (+5)` : '';
            body.innerHTML = `
        <div><b style="color:var(--text)">${bidderName}</b> bid <b style="color:var(--gold-bright)">${state.contract.amount}</b>
          in <b style="color:${isRedSuit(state.trump) ? '#ff7780' : 'var(--text)'}">${SUIT_GLYPHS[state.trump]} ${SUIT_LABELS[state.trump]}</b></div>
        <div>Tricks — You/North: <b style="color:var(--text)">${state.tricksWon[0]}</b>
          &nbsp; West/East: <b style="color:var(--text)">${state.tricksWon[1]}</b></div>
        <div>Earned — You/North: <b style="color:var(--text)">${ep0}</b>
          &nbsp; West/East: <b style="color:var(--text)">${ep1}</b></div>
        ${bestLabel ? `<div style="font-size:12px">${bestLabel}</div>` : ''}
        <div style="margin-top:10px;font-size:18px;color:var(--text)">
          New score: <b style="color:#b8e0c4">${newScore[0]}</b> – <b style="color:var(--text)">${newScore[1]}</b>
        </div>
      `;
            inner.appendChild(body);
        }
        else {
            title.textContent = 'Hand Complete';
        }
        const btn = el('button', 'btn is-primary');
        btn.textContent = 'Next Hand';
        btn.addEventListener('click', () => this.cb.onScoreClose());
        inner.appendChild(btn);
        modal.appendChild(inner);
        return modal;
    }
    renderGameOverModal(state) {
        const modal = el('div', 'modal');
        const inner = el('div', 'modal__inner');
        const title = el('div', 'modal__title');
        const winner = state.totalScore[0] >= 120 ? 'You & North Win!' : 'West & East Win!';
        title.textContent = winner;
        inner.appendChild(title);
        const score = el('div', '');
        score.style.fontSize = '18px';
        score.style.color = 'var(--muted)';
        score.textContent = `Final: You/North ${state.totalScore[0]} — West/East ${state.totalScore[1]}`;
        inner.appendChild(score);
        const btn = el('button', 'btn is-primary');
        btn.textContent = 'Play Again';
        btn.addEventListener('click', () => this.cb.onDealClick());
        inner.appendChild(btn);
        modal.appendChild(inner);
        return modal;
    }
    renderIntroModal() {
        const modal = el('div', 'modal');
        const inner = el('div', 'modal__inner');
        inner.style.maxWidth = '500px';
        inner.style.textAlign = 'left';
        const title = el('div', 'modal__title');
        title.textContent = 'Hundred And Twenties';
        title.style.textAlign = 'center';
        title.style.marginBottom = '20px';
        inner.appendChild(title);
        const content = el('div', '');
        content.style.fontSize = '14px';
        content.style.lineHeight = '1.5';
        content.style.color = 'var(--muted)';
        content.innerHTML = `
      <p>A classic Newfoundland trick-taking game played in teams of two. The first team to <b>120 points</b> wins!</p>
      <h4 style="color:var(--text);margin-top:16px;margin-bottom:8px">Rules at a Glance</h4>
      <ul style="padding-left:20px">
        <li><b>Bidding:</b> Players bid 20-30 points. High bidder picks trump and takes the 3-card kitty.</li>
        <li><b>Trump Ranking:</b> 5 (High), Jack, Ace of Hearts, Ace of Trump, K, Q, 10...</li>
        <li><b>Off-suit Ranking:</b> "Highest in Red (A, K, Q...), Lowest in Black (A, 2, 3...)"</li>
        <li><b>Following Suit:</b> You can play trump at any time. If trump is led, you must follow unless you hold the 5, J, or A of Hearts (the "Big Three").</li>
        <li><b>Scoring:</b> Each trick is 5 points. Best trump is +5. If you fail your bid, you lose those points!</li>
      </ul>
      <p style="margin-top:16px;font-size:12px;opacity:0.8">
        Rules based on: <a href="https://www.cs.mun.ca/~paul/nahanni/paul/c120.html" target="_blank" style="color:var(--gold)">Paul Rice's Guide</a>
      </p>
    `;
        inner.appendChild(content);
        const btn = el('button', 'btn is-primary');
        btn.textContent = 'Start Playing';
        btn.style.marginTop = '20px';
        btn.style.width = '100%';
        btn.addEventListener('click', () => this.cb.onIntroClose());
        inner.appendChild(btn);
        modal.appendChild(inner);
        return modal;
    }
    showTrumpSelectedKittyModal(state, trump) {
        // Replace kitty modal with discard modal.
        const existing = this.root.querySelector('.modal');
        if (existing)
            existing.remove();
        this.root.appendChild(this.renderTrumpSelectedKittyModal(state, trump));
    }
    showToast(message, durationMs = 1800) {
        const existing = this.root.querySelector('.toast');
        if (existing)
            existing.remove();
        if (this.toastTimer)
            clearTimeout(this.toastTimer);
        const toast = el('div', 'toast');
        toast.textContent = message;
        this.root.appendChild(toast);
        this.toastTimer = setTimeout(() => toast.remove(), durationMs);
    }
}
// ------- DOM helpers -------
function el(tag, classes) {
    const e = document.createElement(tag);
    for (const cls of classes.trim().split(/\s+/).filter(Boolean))
        e.classList.add(cls);
    return e;
}
const SVG_SUIT = { H: 'heart', D: 'diamond', C: 'club', S: 'spade' };
function svgRank(rank) {
    if (rank === 'A')
        return '1';
    if (rank === 'J')
        return 'jack';
    if (rank === 'Q')
        return 'queen';
    if (rank === 'K')
        return 'king';
    return rank;
}
function cardSvgUse(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 169.075 244.64');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `/svg-cards.svg#${id}`);
    use.setAttribute('href', `/svg-cards.svg#${id}`);
    svg.appendChild(use);
    return svg;
}
export function cardFace(c) {
    const div = el('div', 'card');
    const id = `${SVG_SUIT[c.suit]}_${svgRank(c.rank)}`;
    div.appendChild(cardSvgUse(id));
    return div;
}
function cardBack() {
    const div = el('div', 'card is-back');
    div.appendChild(cardSvgUse('back'));
    return div;
}
function phaseLabel(state) {
    switch (state.phase) {
        case 'intro': return 'Welcome';
        case 'deal': return 'Deal';
        case 'bid': return 'Bidding';
        case 'kitty': return 'Kitty';
        case 'discard': return 'Discard';
        case 'play': return state.trump ? 'Playing' : 'Play';
        case 'score': return 'Score';
        case 'gameOver': return 'Game Over';
    }
}
