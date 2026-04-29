/** Seats 0/2 form team 0 (you + partner across). Seats 1/3 form team 1. */
export const teamOf = (seat) => (seat % 2 === 0 ? 0 : 1);
export const SEATS = [0, 1, 2, 3];
export const nextSeat = (seat) => ((seat + 1) % 4);
export const partnerOf = (seat) => ((seat + 2) % 4);
export const HUMAN_SEAT = 0;
const STORAGE_KEY = 'h120_game_state';
export function saveState(state) {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    catch (e) {
        console.error('Failed to save state to sessionStorage', e);
    }
}
export function loadState() {
    try {
        const data = sessionStorage.getItem(STORAGE_KEY);
        if (!data)
            return null;
        return JSON.parse(data);
    }
    catch (e) {
        console.error('Failed to load state from sessionStorage', e);
        return null;
    }
}
export function clearSavedState() {
    sessionStorage.removeItem(STORAGE_KEY);
}
