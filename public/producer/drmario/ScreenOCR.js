// Answers two questions neither BoardOCR/PanelOCR/ResultOCR can: "is there actually a bottle on
// screen at all" (hasBottle), and "is this specifically the title screen" (isTitleScreen).
// Needed because Dr. Mario has several screens with no bottle whatsoever (pause -- the whole
// screen goes black except white "PAUSE" text; the title screen; the 1P/2P game-setup menu), and
// every other reader in this project assumes a bottle exists at `field`'s coordinates. Pointed at
// one of those screens instead, BoardOCR/PanelOCR/ResultOCR don't error, they just produce
// misleading output: an all-black pause screen reads as an empty board (nothing wrong reported),
// and ResultOCR's default ('playing' when neither result box matches) means a title/menu screen
// -- or pause -- could otherwise look like an ordinary in-progress round to something like
// RoundTracker.js.
//
// hasBottle's fix is cheap: every bottle has a cyan wall at a fixed position relative to its own
// `field.x`/`field.y` (confirmed against real captures of pause.png, title_screen.png,
// menu_1p.png, menu_2p.png -- none show that color there, where every gameplay capture on hand
// does), so checking those two points is enough to gate all three screens at once without
// needing to identify any of them individually.
//
// isTitleScreen exists for a narrower reason: a player can soft-reset the console mid-round
// (a controller command, not a menu action RoundTracker could otherwise infer from), which jumps
// straight to the title screen with no 'game_over'/'topout' on the way -- hasBottle alone can't
// tell that apart from pause or the settings menu, and RoundTracker needs to specifically know
// "back at the title screen" to end a round that's stuck mid-play with no other signal that it's
// over. The title screen's decorative checkerboard alternates between two greens (0,82,0) and
// (13,148,0) -- see the tile-pitch measurement in git history -- and confirmed against every
// fixture on hand, the darker shade alone isn't unique (some ordinary gameplay levels' own
// checkerboard uses it too, e.g. level13_low_speed.png), but the brighter one never appears
// anywhere except the title screen.

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
const WALL_SAMPLE_RADIUS = 2; // -> a 5x5 block around each check point

// Top-left corner of the title screen, comfortably clear of the "Dr. MARIO" pill logo and the
// menu box below it -- pure checkerboard. Sized to one full tile pitch (16px, alternating every
// 8px -- see the header comment) so it's guaranteed to include a bright tile no matter how a
// small calibration offset shifts which exact pixels land here, the same reasoning as
// WALL_SAMPLE_RADIUS above.
const TITLE_GREEN_SAMPLE_REGION = { x: 8, y: 8, w: 16, h: 16 };
const TITLE_GREEN = [13, 148, 0];

// The bright title-screen green matches at distance 0 on the clean fixture and never appears
// anywhere else on hand at any distance worth naming -- but this can't be as generous as
// WALL_COLOR_MAX_DISTANCE, since the *dark* half of this same checkerboard pair is shared with
// some ordinary gameplay levels' own decorative background (see the header comment), so too loose
// a threshold risks drifting into false positives against real capture noise on those levels.
const TITLE_GREEN_MAX_DISTANCE = 2500;

function colorDistance(a, b) {
	return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

// Scans a rectangular region and returns the smallest distance to `color` found anywhere in it.
function closestColorDistanceInRegion(image, region, color) {
	let best = Infinity;

	for (let y = region.y; y < region.y + region.h; y++) {
		for (let x = region.x; x < region.x + region.w; x++) {
			const dist = colorDistance(getPixel(image, x, y), color);
			if (dist < best) best = dist;
		}
	}

	return best;
}

function closestWallDistance(image, x, y) {
	return closestColorDistanceInRegion(
		image,
		{
			x: x - WALL_SAMPLE_RADIUS,
			y: y - WALL_SAMPLE_RADIUS,
			w: WALL_SAMPLE_RADIUS * 2 + 1,
			h: WALL_SAMPLE_RADIUS * 2 + 1,
		},
		WALL_COLOR
	);
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

export function isTitleScreen(image) {
	return (
		closestColorDistanceInRegion(
			image,
			TITLE_GREEN_SAMPLE_REGION,
			TITLE_GREEN
		) <= TITLE_GREEN_MAX_DISTANCE
	);
}
