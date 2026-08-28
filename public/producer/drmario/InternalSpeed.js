// Dr. Mario's displayed LOW/MED/HI speed isn't the game's actual internal fall-speed value --
// that starts at a base determined by the displayed speed, then ramps up as the player places
// pills within the current level. Per the user's own report of the game's mechanics: after the
// 8th pill has locked (i.e. as the 9th pill enters), the internal speed increases by 1; from
// there it increases by 1 again every 10 pills, up to a maximum of 49 increases -- so HI (base
// 31) caps at 80, MED (base 25) caps at 74, LOW (base 15) caps at 64 (this last cap wasn't
// directly stated, but follows the same +49 pattern as the other two, which were).
//
// piecesEntered is a running count of RoundTracker's piece_entered events since the current round
// started -- garbage doesn't count (piece_entered is already scoped to real player spawns only,
// see RoundTracker.js). The increase timing here is keyed on "as the Nth pill enters" rather than
// "after the Nth pill locks" because there's no separate lock event to key off of, and in practice
// a piece almost always locks before the next one spawns, so counting entries lines up with the
// described mechanic exactly.

const BASE_SPEED = { low: 15, med: 25, hi: 31 };
const FIRST_INCREASE_AT = 9; // piecesEntered when the 1st increase takes effect
const INCREASE_INTERVAL = 10; // pieces between each subsequent increase
const MAX_INCREASES = 49;

export function calculateInternalSpeed(speedName, piecesEntered) {
	const base = BASE_SPEED[speedName];
	if (base === undefined || piecesEntered == null) return null;

	const increases =
		piecesEntered < FIRST_INCREASE_AT
			? 0
			: Math.min(
					MAX_INCREASES,
					Math.floor((piecesEntered - FIRST_INCREASE_AT) / INCREASE_INTERVAL) +
						1
				);

	return base + increases;
}
