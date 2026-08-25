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
// does), so checking those two points is enough to gate all three screens at once without
// needing to identify any of them individually.

import { getPixel } from './shapeMatch.js';

const WALL_COLOR = [0x48, 0xce, 0xdf];

// A clean emulator screenshot matches WALL_COLOR at distance 0, and the closest any non-gameplay
// screen (pause/title/menu) comes at the same coordinates is ~15000 -- huge margin either side
// (see the probe that established this in git history/PR discussion). Real captured video won't
// be that clean -- compression, chroma blur, capture-device color calibration drift (see
// COLOR_PALETTE's comment in constants.js for the same concern applied to pill colors) -- so this
// stays generous relative to the observed 0 rather than tight against it, while remaining
// nowhere near the ~15000 floor where a false positive would become possible.
const WALL_COLOR_MAX_DISTANCE = 6000;

// Offsets from `field`'s origin to a point on each outer wall, comfortably inside the bottle's
// body (not the neck taper or the rounded floor) -- see BoardOCR.js's FIELD/VERSUS.BOTTLE_1P/2P
// for how `field` itself is derived. Same y offset and wall-to-interior distance hold for both
// single-player's and versus's bottles, since every bottle shares FIELD's y origin and wall
// thickness.
const LEFT_WALL_OFFSET = { x: -7, y: 28 };
const RIGHT_WALL_OFFSET_X_PAD = 6; // wall sits field.w + 6 past field.x, mirroring the left wall's -7

// Every other reader in this project samples a small block (see shapeMatch.js's sampleRegion())
// rather than a single exact pixel, specifically so a capture calibration that's off by a pixel
// or two -- normal for a hand-clicked crop rectangle against real video, unlike these pixel-exact
// fixture screenshots -- doesn't silently break identification. hasBottle originally checked one
// bare pixel per side instead; that read fine against the fixtures (which is all it was verified
// against) but reportedly always read as "no bottle" against real captured video in the harness.
// Sampling a block and taking its closest match gives the same jitter tolerance every other
// reader already has.
const SAMPLE_RADIUS = 2; // -> a 5x5 block around each check point

function colorDistance(a, b) {
	return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function closestWallDistance(image, x, y) {
	let best = Infinity;

	for (let dy = -SAMPLE_RADIUS; dy <= SAMPLE_RADIUS; dy++) {
		for (let dx = -SAMPLE_RADIUS; dx <= SAMPLE_RADIUS; dx++) {
			const dist = colorDistance(getPixel(image, x + dx, y + dy), WALL_COLOR);
			if (dist < best) best = dist;
		}
	}

	return best;
}

export function hasBottle(image, field) {
	const y = field.y + LEFT_WALL_OFFSET.y;
	const left = closestWallDistance(image, field.x + LEFT_WALL_OFFSET.x, y);
	const right = closestWallDistance(
		image,
		field.x + field.w + RIGHT_WALL_OFFSET_X_PAD,
		y
	);

	return left <= WALL_COLOR_MAX_DISTANCE && right <= WALL_COLOR_MAX_DISTANCE;
}
