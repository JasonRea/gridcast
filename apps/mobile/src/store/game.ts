/**
 * The game screen's state machine is the web's zustand store, imported as is (no DOM in it), so
 * the queue, stoppage hold and card timing are identical on both clients. See DECISIONS.md.
 */
export { useGame } from '@web/store/game';
export type { GameStore, Lines, WpPoint } from '@web/store/game';
