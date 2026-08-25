// Answers "is there actually a bottle on screen at all" -- distinct from ResultOCR's job of
// reading a bottle's *contents* once we know one is there. Needed because Dr. Mario has several
// screens with no bottle whatsoever (pause -- the whole screen goes black except white "PAUSE"
// text; the title screen; the 1P/2P game-setup menu), and every other reader in this project
// assumes a bottle exists at `field`'s coordinates. Pointed at one of those screens instead,
// BoardOCR/PanelOCR/ResultOCR don't error, they just produce misleading output: an all-black
// pause screen reads as an empty board (nothing wrong reported), and ResultOCR's default
// ('playing' when neither result box matches) means a title/menu screen -- or pause -- could
// otherwise look like an ordinary in-progress round to something like RoundTracker.js.
//
// The fix is cheap: every bottle has a cyan wall at a fixed position relative to its own
// `field.x`/`field.y` (confirmed against real captures of pause.png, title_screen.png,
// menu_1p.png, menu_2p.png -- none show that color there, where every gameplay capture on hand
// does), so checking those two pixels is enough to gate all three screens at once without
// needing to identify any of them individually.

import { getPixel } from './shapeMatch.js';

const WALL_COLOR = [0x48, 0xce, 0xdf];
const WALL_COLOR_MAX_DISTANCE = 900; // generous vs. a clean match's ~0; leaves room for capture noise

// Offsets from `field`'s origin to a point on each outer wall, comfortably inside the bottle's
// body (not the neck taper or the rounded floor) -- see BoardOCR.js's FIELD/VERSUS.BOTTLE_1P/2P
// for how `field` itself is derived. Same y offset and wall-to-interior distance hold for both
// single-player's and versus's bottles, since every bottle shares FIELD's y origin and wall
// thickness.
const LEFT_WALL_OFFSET = { x: -7, y: 28 };
const RIGHT_WALL_OFFSET_X_PAD = 6; // wall sits field.w + 6 past field.x, mirroring the left wall's -7

function isWallColor(rgb) {
	const dist =
		(rgb[0] - WALL_COLOR[0]) ** 2 +
		(rgb[1] - WALL_COLOR[1]) ** 2 +
		(rgb[2] - WALL_COLOR[2]) ** 2;

	return dist <= WALL_COLOR_MAX_DISTANCE;
}

export function hasBottle(image, field) {
	const y = field.y + LEFT_WALL_OFFSET.y;
	const left = getPixel(image, field.x + LEFT_WALL_OFFSET.x, y);
	const right = getPixel(image, field.x + field.w + RIGHT_WALL_OFFSET_X_PAD, y);

	return isWallColor(left) && isWallColor(right);
}
