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
//   In versus mode specifically, this isn't the *whole* boundary, though: one player's win/loss
//   ends the round for both, but reportedly (live, not yet captured) the other bottle's own
//   result can keep reading 'playing' regardless -- one instance only ever sees its own bottle,
//   so it has no way to notice that on its own. See endRound() below for how the consumer running
//   both players' trackers closes that gap.
// - Virus count isn't monotonic the way Tetris's line count is: it counts *up* during each
//   round's initial population (viruses are placed one at a time up to 4*(level+1) for that
//   level) before counting down as the player clears them. See PHASE below.
// - There's no on-screen piece counter to read the way Tetris's T/J/Z/O/S/L/I boxes are. Instead,
//   piece_entered fires when a player-controlled piece spawns, detected by position rather than
//   raw color. Per confirmed report: a player piece always spawns horizontally at the same fixed
//   pair of middle columns (SPAWN_COL_LEFT/RIGHT below), never anywhere else -- and separately,
//   versus mode can add "garbage" to a bottle as loose single half-pills that can land in *any*
//   column (never the paired-horizontal shape a real spawn is). So watching specifically that
//   fixed pair, rather than the whole top row, both catches every genuine spawn and won't
//   misidentify a garbage half landing elsewhere as one -- important since garbage isn't
//   detected/reported at all yet (no captures of it exist to verify a design against), and this
//   keeps piece_entered from being polluted by it once it is.
//
//   An earlier version fired on every empty->occupied transition of the spawn pair, aggregated
//   as one flag. That double-counted real, ordinary player input: sliding a piece off the spawn
//   pair and back before it starts falling, or rotating it 180 (horizontal -> vertical -> back to
//   horizontal, which reverses which color sits on which side) both leave, then re-fill, the
//   spawn pair without a real spawn happening. Fixed by requiring positive evidence the
//   previously-reported piece has actually left play before re-arming detection -- see
//   #armed/#detectPieceEntries -- using two independent, complementary signals, either being
//   enough:
//     - the next-pill preview changing. It only updates on a genuine spawn (confirmed via real
//       captures -- see BoardOCR.identifyNextPill's doc comment -- to stay constant across frames
//       while the current piece is in play, including while the player moves/rotates it). Blind
//       spot: two real, distinct, consecutive pieces can coincidentally share the same color pair
//       (only 3 colors exist), which this can't tell apart from the same piece never having left.
//     - new pill content appearing anywhere from 1 row below spawn downward (DESCENT_ROW_START
//       below, checked as a region rather than one exact row so an OCR poll that misses the piece
//       passing through any single row still catches it further down). Rotating a horizontal pill
//       to vertical keeps one cell on the spawn row and moves the other *up*, off the top of the
//       visible bottle, not down -- confirmed report -- so a rotation alone can never put anything
//       in the row right below spawn, only real descent can. Blind spot: a piece that locks
//       against a tall stack before ever falling that far never triggers it. (The reverse mistake
//       is possible too, if rarer: an orphaned stray half-pill -- see the versus-mode note above
//       about loose halves -- falling into that region from an unrelated match-clear elsewhere
//       while this piece is still near the top would also read as "new content", re-arming
//       detection early.)
//   The two under-counting blind spots are unrelated (color coincidence vs. stack height), so
//   requiring only one signal to fire is meaningfully more robust than either alone; only their
//   conjunction (both a coincidental color match *and* an early lock) can still fool this. This is
//   a heuristic that hasn't been validated against real captured timing data (only against
//   hand-built frame sequences and one live-harness repro) -- worth rechecking if a live session
//   ever suggests otherwise.
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

// The row right below spawn -- see the header comment for why this threshold is safe: rotating a
// horizontal pill to vertical moves a cell *up*, off the top of the bottle, never down into this
// row, so anything appearing here can only be real descent.
const DESCENT_ROW_START = 1;

function virusTarget(level) {
	return level === null || level === undefined
		? null
		: Math.min(4 * (level + 1), MAX_VIRUS_COUNT);
}

function isPillHalf(cell) {
	return !!cell && cell.type === 'pill';
}

// A comparable key for a next-pill reading, or null if either half wasn't confidently read as a
// pill (in which case we can't use this signal and must fall back on the other one).
function nextPillKey(nextPill) {
	if (!nextPill) return null;
	const { left, right } = nextPill;
	if (left?.type !== 'pill' || right?.type !== 'pill') return null;
	return `${left.color}:${right.color}`;
}

// All cells from DESCENT_ROW_START down to the bottom, flattened -- checked as a region rather
// than a single row so an OCR poll that misses the piece passing through any one row on its way
// down still catches it further along.
function descentRegionMask(board) {
	return board.slice(DESCENT_ROW_START).flatMap(row => row.map(isPillHalf));
}

// True if `current` has a pill half somewhere `baseline` didn't -- i.e. something new landed
// there since baseline was captured, not just that content happens to still be there.
function gainedPillContent(baseline, current) {
	return current.some((occupied, i) => occupied && !baseline[i]);
}

export default class RoundTracker extends EventTarget {
	#phase = PHASE.UNKNOWN;
	#roundId = 0;
	#level = null;
	#virusTargetCount = null;
	#virusCount = null;
	#spawnPairOccupied = false;
	#armed = true; // ready to treat the next spawn-pair occupation as a genuine new piece
	#lastNextPillKey = null;
	#descentBaseline = null;

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
			this.#armed = true;
			this.#lastNextPillKey = null;
			this.#descentBaseline = null;

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

				// round_start already fired with level/virusTarget: null -- this is the
				// correction, for anything that wants the authoritative value without having to
				// wait for (or infer it from) round_ready.
				this.dispatchEvent(
					new CustomEvent('round_level_confirmed', {
						detail: {
							roundId: this.#roundId,
							level: this.#level,
							virusTarget: this.#virusTargetCount,
						},
					})
				);
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

		this.#detectPieceEntries(frame.board, frame.nextPill);
	}

	// Versus mode's round boundary is shared between both bottles -- one player winning
	// (stage_clear) or losing (topout) ends the round for both at once, even though the OTHER
	// bottle's own ResultOCR reading can keep showing 'playing' for a while (confirmed live: no
	// captures exist yet of exactly what that bottle shows in the meantime). Since one instance
	// only ever sees its own bottle's frames, it has no way to notice this on its own -- the
	// consumer running both players' trackers needs to call this on the *other* tracker when one
	// instance's own round_end fires (see harness.js's versus wiring), so the linked instance
	// also ends its round (and, on its own very next 'playing' frame -- e.g. the next round's
	// virus population starting -- correctly detects a new round_start on its own, the same way
	// it would after any ordinary round_end).
	endRound(outcome) {
		if (this.#phase === PHASE.ENDED) return; // already ended via its own result reading
		this.#phase = PHASE.ENDED;
		this.dispatchEvent(
			new CustomEvent('round_end', {
				detail: {
					roundId: this.#roundId,
					outcome,
					virusCount: this.#virusCount,
				},
			})
		);
	}

	// frame.nextPill: the { left, right } shape BoardOCR.identifyNextPill() returns -- see the
	// header comment for how it's used alongside descent evidence to tell a genuine new spawn
	// apart from the previously-reported piece just moving/rotating back onto the spawn pair.
	#detectPieceEntries(board, nextPill) {
		const left = board[0][SPAWN_COL_LEFT];
		const right = board[0][SPAWN_COL_RIGHT];
		const occupied = isPillHalf(left) && isPillHalf(right);

		if (!this.#armed) {
			const currentKey = nextPillKey(nextPill);
			const nextPillChanged =
				currentKey !== null && currentKey !== this.#lastNextPillKey;
			const descentAdvanced =
				this.#descentBaseline !== null &&
				gainedPillContent(this.#descentBaseline, descentRegionMask(board));

			if (nextPillChanged || descentAdvanced) {
				this.#armed = true;
			}
		}

		if (occupied && !this.#spawnPairOccupied && this.#armed) {
			this.#armed = false;
			this.#lastNextPillKey = nextPillKey(nextPill);
			this.#descentBaseline = descentRegionMask(board);

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
