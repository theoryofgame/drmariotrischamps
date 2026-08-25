// Turns a sequence of per-frame OCR results (one bottle's worth -- see BoardOCR/PanelOCR/
// ResultOCR) into round-lifecycle events. Mirrors the role of ../GameTracker.js (sits between
// raw per-frame OCR and anything that wants game *events*, not just frame snapshots), but the
// specifics differ a fair bit because Dr. Mario differs from Tetris in ways that change what's
// worth tracking:
//
// - We already OCR an explicit round-end marker (ResultOCR's 'stage_clear'/'game_over'/
//   'topout'), where Tetris has to infer game-over indirectly. So unlike GameTracker, this
//   doesn't need a score/lines heuristic to detect a round boundary -- the playing -> not-
//   playing -> playing transition on `result` *is* the boundary. That heuristic is only used to
//   bootstrap the very first frame ever seen, before any boundary has actually been observed.
// - Virus count isn't monotonic the way Tetris's line count is: it counts *up* during each
//   round's initial population (viruses are placed one at a time up to 4*(level+1) for that
//   level) before counting down as the player clears them. See PHASE below.
// - There's no on-screen piece counter to read the way Tetris's T/J/Z/O/S/L/I boxes are. Instead,
//   piece_entered fires when a player-controlled piece spawns, detected by position rather than
//   by diffing the next-pill preview (which would miss a repeat -- Dr. Mario is known for
//   "rushes": long runs of the identical pill color/shape, where the preview wouldn't visibly
//   change even though a new piece did spawn). Per confirmed report: a player piece always
//   spawns horizontally at the same fixed pair of middle columns (SPAWN_COL_LEFT/RIGHT below),
//   never anywhere else -- and separately, versus mode can add "garbage" to a bottle as loose
//   single half-pills that can land in *any* column (never the paired-horizontal shape a real
//   spawn is). So watching specifically that fixed pair, rather than the whole top row, both
//   catches every genuine spawn and won't misidentify a garbage half landing elsewhere as one --
//   important since garbage isn't detected/reported at all yet (no captures of it exist to
//   verify a design against), and this keeps piece_entered from being polluted by it once it is.
//   An earlier version watched the whole row and only tracked one aggregate occupied/empty flag;
//   that misread lateral movement (the player shifting/rotating a piece that's still sitting in
//   row 0 before it starts falling) as repeated new spawns, since each new column the same piece
//   slid through looked like a fresh arrival. Scoping to just the spawn pair incidentally fixes
//   that too, in the common case -- the one gap left is a piece that shifts away from the spawn
//   pair and later shifts back onto it *before* locking, which would double count. Full
//   piece-position tracking would close that; not done here as it's a rarer case than the bug
//   just fixed and adds real complexity for it.
//
// One instance tracks one bottle. Versus mode (two independent bottles) should use two
// instances, the same way Tetris runs one GameTracker per OcrPlayer.

import { COLS } from './constants.js';

const PHASE = {
	UNKNOWN: 'unknown', // no round boundary observed yet
	POPULATING: 'populating', // round started, viruses still being placed
	PLAYING: 'playing', // population complete, ordinary gameplay
	ENDED: 'ended', // result left 'playing'; waiting for the next round to start
};

// 4*(level+1) holds up to level 20 (84 viruses); level 21+ is reported to stay capped at 84
// rather than continuing to climb -- not yet confirmed against a capture, so worth rechecking
// if a high-level round is ever seen not reaching its computed target.
const MAX_VIRUS_COUNT = 84;

// A player piece always spawns as a horizontal pair centered in the bottle -- columns 4/5 in
// 1-indexed terms, i.e. these two 0-indexed ones.
const SPAWN_COL_LEFT = COLS / 2 - 1;
const SPAWN_COL_RIGHT = COLS / 2;

function virusTarget(level) {
	return level === null || level === undefined
		? null
		: Math.min(4 * (level + 1), MAX_VIRUS_COUNT);
}

function isPillHalf(cell) {
	return !!cell && cell.type === 'pill';
}

export default class RoundTracker extends EventTarget {
	#phase = PHASE.UNKNOWN;
	#roundId = 0;
	#level = null;
	#virusTargetCount = null;
	#virusCount = null;
	#spawnPairOccupied = false;

	// frame: { board, level, virus, result, hasBottle, ... } -- i.e. one bottle's worth of a
	// DrMarioOCR result (single-player's top-level shape, or versus's player1/player2
	// sub-object).
	processFrame(frame) {
		// No bottle on screen at all (pause/title/menu -- see ScreenOCR.js) means every other
		// field on `frame` is null and tells us nothing real. Treat it as a complete no-op rather
		// than as a frame to interpret: pause mid-round must not look like a round boundary just
		// because `result` reads as something other than 'playing' while paused, and a title/menu
		// screen sitting in front of the capture must not bootstrap a bogus round_start off
		// ResultOCR's 'playing' default.
		if (frame.hasBottle === false) return;

		if (frame.result !== 'playing') {
			if (this.#phase !== PHASE.ENDED) {
				this.#phase = PHASE.ENDED;
				this.dispatchEvent(
					new CustomEvent('round_end', {
						detail: {
							roundId: this.#roundId,
							outcome: frame.result,
							virusCount: this.#virusCount,
						},
					})
				);
			}
			return;
		}

		if (this.#phase === PHASE.UNKNOWN || this.#phase === PHASE.ENDED) {
			this.#roundId++;
			this.#phase = PHASE.POPULATING;
			this.#level = frame.level ?? null;
			this.#virusTargetCount = virusTarget(this.#level);
			this.#virusCount = frame.virus ?? null;
			this.#spawnPairOccupied = false;

			this.dispatchEvent(
				new CustomEvent('round_start', {
					detail: {
						roundId: this.#roundId,
						level: this.#level,
						virusTarget: this.#virusTargetCount,
					},
				})
			);
		}

		if (this.#phase === PHASE.POPULATING) {
			// level (and the target derived from it) might not have been readable yet on the
			// frame round_start fired from -- keep picking it up until it is, rather than
			// leaving this round permanently unable to reach round_ready.
			if (
				this.#level === null &&
				frame.level !== null &&
				frame.level !== undefined
			) {
				this.#level = frame.level;
				this.#virusTargetCount = virusTarget(this.#level);
			}

			this.#virusCount = frame.virus ?? this.#virusCount;

			if (
				this.#virusTargetCount !== null &&
				this.#virusCount !== null &&
				this.#virusCount >= this.#virusTargetCount
			) {
				this.#phase = PHASE.PLAYING;
				this.dispatchEvent(
					new CustomEvent('round_ready', {
						detail: { roundId: this.#roundId, virusCount: this.#virusCount },
					})
				);
			}
		} else {
			this.#virusCount = frame.virus ?? this.#virusCount;
		}

		this.#detectPieceEntries(frame.board);
	}

	#detectPieceEntries(board) {
		const left = board[0][SPAWN_COL_LEFT];
		const right = board[0][SPAWN_COL_RIGHT];
		const occupied = isPillHalf(left) && isPillHalf(right);

		if (occupied && !this.#spawnPairOccupied) {
			this.dispatchEvent(
				new CustomEvent('piece_entered', {
					detail: {
						roundId: this.#roundId,
						cells: [
							{ col: SPAWN_COL_LEFT, shape: left.shape, color: left.color },
							{ col: SPAWN_COL_RIGHT, shape: right.shape, color: right.color },
						],
					},
				})
			);
		}

		this.#spawnPairOccupied = occupied;
	}
}
