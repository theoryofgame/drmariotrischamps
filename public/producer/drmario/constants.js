// Geometry and reference data for reading an NES Dr. Mario bottle from a captured video frame.
//
// Unlike the Tetris OCR (see ../constants.js), which reads each field cell as a flat color
// sampled against a level-dependent palette, Dr. Mario cells must be told apart primarily by
// *shape*: viruses and pill segments can share the same body color, and the only way to tell
// a virus from a pill, or a pill's orientation, is to recognize the actual NES tile artwork.
// COLOR_PALETTE below is only used as a secondary signal (to color a matched pill shape, and
// as a sanity check on matched virus shapes).
//
// All coordinates are expressed against a clean, undistorted single-player NES Dr. Mario frame
// at native resolution (256x224). A capture pipeline integration will need to map these onto
// whatever resolution/crop the capture device actually provides, the same way the Tetris OCR's
// RETRON_HD_CONFIG maps REFERENCE_LOCATIONS onto capture-card-specific crops.
export const REFERENCE_SIZE = { w: 256, h: 224 };

// The bottle's playfield interior, i.e. the black rectangle pieces actually occupy,
// excluding the cyan/purple bottle walls and neck.
export const FIELD = { x: 96, y: 72, w: 64, h: 128 };

export const COLS = 8;
export const ROWS = 16;
export const CELL_SIZE = 8; // pixels per cell, at REFERENCE_SIZE scale, both axes

// The pill Dr. Mario holds above his head, previewing the piece that will spawn after the one
// currently in play. Always drawn as a plain horizontal pill (a 'left' half at this position
// immediately followed by a 'right' half, i.e. two more CELL_SIZE tiles, the same as two
// adjacent bottle cells), regardless of what orientation the pill actually spawns in.
export const NEXT_PILL = { x: 190, y: 62 };

// Reference RGB values for the three virus/pill colors, sampled directly from a clean emulator
// capture. These hold constant across levels and speeds (only the decorative checkerboard
// background outside the bottle changes with level/speed), which makes Dr. Mario's coloring
// simpler than Tetris's level-cycled palette -- but different capture devices/emulators may
// still shift these hues, the same way Tetris has per-device palettes (see ../palettes.js).
export const COLOR_PALETTE = {
	red: [0xb8, 0x1e, 0x7c],
	blue: [0x64, 0xb0, 0xfe],
	yellow: [0xbd, 0xbf, 0x00],
};

// A screen LAYOUT is a distinct arrangement of on-screen regions (score panels, bottle
// position(s), etc), the same way Tetris's GAME_TYPE distinguishes 'classic' from
// 'das_trainer'. Dr. Mario needs this too, but for a different reason: single-player shows one
// bottle with a TOP/SCORE panel and a LEVEL/SPEED/VIRUS panel either side of it (reverse
// engineered below), while versus mode shows two bottles side by side with a different set of
// panels (relative score/win count, presumably no per-player TOP score). Versus has not been
// captured or reverse engineered yet, so it isn't in CONFIGS -- selecting it should fail loudly
// rather than silently reuse single-player's geometry, which would be wrong in basically every
// coordinate.
export const LAYOUT = {
	SINGLE_PLAYER: 'single_player',
	// VERSUS: 'versus', // TODO: needs its own reference captures + REFERENCE_LOCATIONS/CONFIGS entry
};

// Crop rectangles for the single-player screen's non-bottle regions, in the same native
// 256x224 reference frame as FIELD above. All measured directly off a real capture (see
// tests/fixtures/dr_mario/level00_frameA.png) the same way FIELD/templates.js were.
//
// Of these, `field` and `next_pill` have working scanners today (BoardOCR.js). The rest are
// scaffolding: their crop rectangles are real and verified, but nothing reads them yet --
//   - `top`/`score`/`level`/`virus` are digit sequences. Building a digit template bank (the
//     Dr. Mario equivalent of the Tetris OCR's digit templates, see ../TetrisOCR.js) needs
//     reference captures covering all 10 digits; the captures on hand only show 0/1/2/4/5.
//   - `speed` is not digits at all -- it's one of a small set of words (LOW/MED/HI), so it needs
//     matching against whole-word templates rather than per-digit ones.
export const REFERENCE_LOCATIONS = {
	field: { crop: FIELD },
	next_pill: { crop: { x: NEXT_PILL.x, y: NEXT_PILL.y, w: 15, h: 7 } },
	top: { crop: { x: 16, y: 56, w: 55, h: 7 }, pattern: 'DDDDDDD' },
	score: { crop: { x: 16, y: 80, w: 55, h: 7 }, pattern: 'DDDDDDD' },
	level: { crop: { x: 216, y: 144, w: 15, h: 7 }, pattern: 'DD' },
	virus: { crop: { x: 216, y: 192, w: 15, h: 7 }, pattern: 'DD' },
	speed: {
		crop: { x: 208, y: 168, w: 23, h: 7 },
		kind: 'enum',
		values: ['low', 'med', 'hi'],
	},
};

export const CONFIGS = {
	[LAYOUT.SINGLE_PLAYER]: {
		layout: LAYOUT.SINGLE_PLAYER,
		reference: '/producer/drmario/reference_ui_single_player.png',
		fields: ['field', 'next_pill', 'top', 'score', 'level', 'virus', 'speed'],
	},
};
