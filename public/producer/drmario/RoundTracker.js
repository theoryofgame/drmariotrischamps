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
// - There's no on-screen piece counter to read the way Tetris's T/J/Z/O/S/L/I boxes are. Pills
//   always spawn at the same fixed position (top-middle of the bottle), so a new one entering
//   play is detected the same way -- not by diffing the next-pill preview, which would miss a
//   repeat (Dr. Mario is known for "rushes": long runs of the identical pill color/shape, where
//   the preview wouldn't visibly change even though a new piece did spawn) -- but by watching
//   the top row for pill content appearing where there was none. This has to be tracked as one
//   aggregate "is anything in row 0" flag, not per column: a piece can sit in row 0 for several
//   frames while the player shifts/rotates it before it starts falling, and a *per-column* check
//   (an earlier version of this file) misreads every column the same piece slides through as a
//   separate new piece. The aggregate flag only flips on when row 0 goes from fully empty to
//   holding something, so lateral movement within row 0 -- which never empties it in between --
//   doesn't re-trigger. This also means it currently can't tell a genuinely new piece from
//   garbage arriving in another column *while* the active piece is still sitting in row 0, since
//   both would just look like "row 0 still occupied" -- acceptable for now since the actual
//   garbage mechanic hasn't been captured/reverse engineered yet to know if that overlap is even
//   possible.
//
// One instance tracks one bottle. Versus mode (two independent bottles) should use two
// instances, the same way Tetris runs one GameTracker per OcrPlayer.

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
	#topRowOccupied = false;

	// frame: { board, level, virus, result, ... } -- i.e. one bottle's worth of a DrMarioOCR
	// result (single-player's top-level shape, or versus's player1/player2 sub-object).
	processFrame(frame) {
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
			this.#topRowOccupied = false;

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
		const cells = board[0]
			.map((cell, col) => ({ col, cell }))
			.filter(({ cell }) => isPillHalf(cell));

		const occupied = cells.length > 0;

		if (occupied && !this.#topRowOccupied) {
			this.dispatchEvent(
				new CustomEvent('piece_entered', {
					detail: {
						roundId: this.#roundId,
						cells: cells.map(({ col, cell }) => ({
							col,
							shape: cell.shape,
							color: cell.color,
						})),
					},
				})
			);
		}

		this.#topRowOccupied = occupied;
	}
}
