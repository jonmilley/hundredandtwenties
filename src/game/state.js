/** Seats 0/2 form team 0 (you + partner across). Seats 1/3 form team 1. */
export const teamOf = (seat) => (seat % 2 === 0 ? 0 : 1);
export const SEATS = [0, 1, 2, 3];
export const nextSeat = (seat) => ((seat + 1) % 4);
export const partnerOf = (seat) => ((seat + 2) % 4);
export const HUMAN_SEAT = 0;
