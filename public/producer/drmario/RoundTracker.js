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
//   the whole top row for a cell going from unoccupied to holding a pill half. Generalized to
//   the whole row rather than just the two spawn columns because that's also the primitive a
//   future garbage-tracking feature would need (garbage arrives as loose halves, potentially in
//   other columns), even though the actual garbage mechanic hasn't been captured/reverse
//   engineered yet.
//
// One instance tracks one bottle. Versus mode (two independent bottles) should use two
// instances, the same way Tetris runs one GameTracker per OcrPlayer.

const PHASE = {
	UNKNOWN: 'unknown', // no round boundary observed yet
	POPULATING: 'populating', // round started, viruses still being placed
	PLAYING: 'playing', // population complete, ordinary gameplay
	ENDED: 'ended', // result left 'playing'; waiting for the next round to start
};

function virusTarget(level) {
	return level === null || level === undefined ? null : 4 * (level + 1);
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
	#topRowOccupied = [];

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
			this.#level = frame.level;
			this.#virusTargetCount = virusTarget(frame.level);
			this.#virusCount = frame.virus ?? null;
			this.#topRowOccupied = frame.board[0].map(() => false);

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
		const topRow = board[0];

		topRow.forEach((cell, col) => {
			const occupied = isPillHalf(cell);

			if (occupied && !this.#topRowOccupied[col]) {
				this.dispatchEvent(
					new CustomEvent('piece_entered', {
						detail: {
							roundId: this.#roundId,
							col,
							shape: cell.shape,
							color: cell.color,
						},
					})
				);
			}

			this.#topRowOccupied[col] = occupied;
		});
	}
}
