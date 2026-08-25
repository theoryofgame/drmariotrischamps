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
//   both players' trackers closes that gap. Separately, a player can soft-reset the console
//   mid-round via a controller command, which also isn't a `result` transition ResultOCR would
//   ever see -- it jumps straight to the title screen instead. processFrame() handles that one
//   directly (not via endRound()) since ScreenOCR.isTitleScreen() is a whole-screen fact already
//   delivered to both bottles' frames identically, unlike a single bottle's own result.
// - Virus count isn't monotonic the way Tetris's line count is: it counts *up* during each
//   round's initial population (viruses are placed one at a time up to 4*(level+1) for that
//   level) before counting down as the player clears them. See PHASE below.
// - There's no on-screen piece counter to read the way Tetris's T/J/Z/O/S/L/I boxes are. Instead,
//   piece_entered fires when a player-controlled piece spawns, detected by position rather than
//   raw color. Per confirmed report: a player piece always spawns horizontally at the same fixed
//   pair of middle columns (SPAWN_COL_LEFT/RIGHT below), never anywhere else -- and separately,
//   versus mode can add "garbage" to a bottle as loose single half-pills (PILL_SHAPE_TEMPLATES'
//   'single' shape -- see templates.js) that can land in *any* column, 2/3/4 at once with at
//   least one empty column between each (confirmed report), never the paired-horizontal shape a
//   real spawn is. So watching specifically that fixed pair by shape, not just position, both
//   catches every genuine spawn and won't misidentify a garbage half landing on the spawn columns
//   as one -- see #detectGarbageEntries for the separate garbage_entered event this same
//   distinction makes possible. If a garbage half lands on an already-occupied column it
//   overwrites what was there (confirmed report); #detectGarbageEntries deliberately doesn't
//   track that case, only a column that was genuinely empty beforehand.
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

// A real spawn's two cells are always the paired 'left'/'right' shapes (see templates.js) --
// never 'single', which is exclusively how a loose garbage half or an orphaned match-clear
// remnant renders. Distinguishing by shape (not just isPillHalf's type) keeps a garbage half
// that happens to land on a spawn column from ever looking like part of a real spawn.
function isHorizontalPillHalf(cell) {
	return (
		!!cell &&
		cell.type === 'pill' &&
		(cell.shape === 'left' || cell.shape === 'right')
	);
}

// See templates.js's PILL_SHAPE_TEMPLATES comment: 'single' also occurs in ordinary (non-versus)
// play once a match clears one half of a landed pill, leaving the other standing -- but that
// case can only ever transition from an already-occupied cell (the pair was there first), never
// from an empty one, which is exactly the transition #detectGarbageEntries requires. A cell can
// only go directly from empty to 'single' by something dropping in from outside as a loose half
// -- garbage's whole signature (confirmed report).
function isGarbageHalf(cell) {
	return !!cell && cell.type === 'pill' && cell.shape === 'single';
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
	#topRowEmpty = new Array(COLS).fill(true); // last frame's row-0 occupancy, per column

	// frame: { board, level, virus, result, hasBottle, isTitleScreen, ... } -- i.e. one bottle's
	// worth of a DrMarioOCR result (single-player's top-level shape, or versus's player1/player2
	// sub-object).
	processFrame(frame) {
		// No bottle on screen at all (pause/title/menu -- see ScreenOCR.js) means every other
		// field on `frame` is null and tells us nothing real. Treat it as a complete no-op rather
		// than as a frame to interpret: pause mid-round must not look like a round boundary just
		// because `result` reads as something other than 'playing' while paused, and a title/menu
		// screen sitting in front of the capture must not bootstrap a bogus round_start off
		// ResultOCR's 'playing' default. The one exception is the title screen specifically: a
		// player can soft-reset mid-round via a controller command, jumping straight there with
		// none of the usual 'game_over'/'topout' result on the way, which would otherwise leave a
		// round stuck open forever with no other signal it's over. Only ends a round that was
		// actually in progress (POPULATING/PLAYING) -- e.g. not on startup, if the tracker's very
		// first frame happens to be the title screen with no round to end yet.
		if (frame.hasBottle === false) {
			if (
				frame.isTitleScreen &&
				(this.#phase === PHASE.POPULATING || this.#phase === PHASE.PLAYING)
			) {
				this.#phase = PHASE.ENDED;
				this.dispatchEvent(
					new CustomEvent('round_end', {
						detail: {
							roundId: this.#roundId,
							outcome: 'title_screen',
							virusCount: this.#virusCount,
						},
					})
				);
			}
			return;
		}

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
			this.#topRowEmpty = new Array(COLS).fill(true);

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
		this.#detectGarbageEntries(frame.board);
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
		const occupied = isHorizontalPillHalf(left) && isHorizontalPillHalf(right);

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

	// Garbage enters as one or more loose 'single' halves along the top row -- unlike a real
	// spawn, in any column(s), 2/3/4 at once, always with at least a column of gap between
	// simultaneous ones (confirmed report; not something this needs to verify itself, since each
	// column's own empty->single transition is independently sufficient evidence). No #armed-style
	// re-arming is needed the way piece detection has: a real spawn can look like it "re-enters"
	// the same spot via lateral movement or rotation, but a cell can only ever go directly from
	// empty to 'single' by something dropping in from outside (see isGarbageHalf) -- there's no
	// equivalent false re-trigger to guard against here.
	#detectGarbageEntries(board) {
		const newCells = [];
		const topRowEmpty = [];

		for (let col = 0; col < COLS; col++) {
			const cell = board[0][col];

			if (this.#topRowEmpty[col] && isGarbageHalf(cell)) {
				newCells.push({ col, shape: cell.shape, color: cell.color });
			}

			topRowEmpty.push(!cell || cell.type === 'empty');
		}

		if (newCells.length > 0) {
			this.dispatchEvent(
				new CustomEvent('garbage_entered', {
					detail: { roundId: this.#roundId, cells: newCells },
				})
			);
		}

		this.#topRowEmpty = topRowEmpty;
	}
}
