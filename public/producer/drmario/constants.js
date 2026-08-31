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
// engineered below), while versus mode shows two bottles side by side sharing a single
// LEVEL/SPEED panel above and VIRUS panel below (both listing each player's value side by
// side), a next-pill preview in each bottle's own neck instead of a Mario portrait, and a
// "crowns" grid between the bottles tracking round wins instead of a TOP/SCORE panel at all
// (see VERSUS below).
export const LAYOUT = {
	SINGLE_PLAYER: 'single_player',
	VERSUS: 'versus',
};

// Crop rectangles for the single-player screen's non-bottle regions, in the same native
// 256x224 reference frame as FIELD above. All measured directly off real captures (see
// tests/fixtures/dr_mario) the same way FIELD/templates.js were.
//
// All of these now have working scanners: `field`/`next_pill` via BoardOCR.js, and
// `top`/`score`/`level`/`virus` (digit sequences, via PanelOCR.readNumber()) and `speed` (one of
// LOW/MED/HI, matched as a whole word rather than per-digit, via PanelOCR.readSpeed()).
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

// Single-player-only independent per-region calibration (see DrMarioOCR.js) -- each region below
// is captured from its own video-pixel crop and resampled to its own fixed `size`, regardless of
// that raw crop's own pixel dimensions, rather than being read as a fixed offset within one
// shared 256x224 frame the way REFERENCE_LOCATIONS above still describes. This directly mirrors
// the existing Tetris OCR's own per-task canvas + fixed target resolution, which is what actually
// absorbs a given capture's own overscan/cropping quirks without requiring every other region to
// match -- confirmed by researching its actual implementation (cpuTetrisOCR.js/TASK_RESIZE), not
// just this file's own REFERENCE_LOCATIONS precedent.
//
// `refPoint`/`size` describe each region's position/size in the *old* shared 256x224 frame --
// used only once, as the "quick seed" derivation's extrapolation anchor when the operator clicks
// the whole screen (or the bottle -- see producer.js's calibrationFromBottleRect()) instead of
// clicking each region individually; never consulted again at read time. `next_pill` deliberately
// uses `CELL_SIZE * 2` (16px) here, not REFERENCE_LOCATIONS.next_pill.crop.w (15px, informational
// only there -- identifyNextPill() ignores it and always steps by CELL_SIZE) -- 15px would clip
// the last column of the right-hand tile's own capture.
//
// `field` alone needs a margin beyond the bare playfield interior: ScreenOCR.hasBottle()'s wall-
// check points reach outside it (~9px left / ~8px right of field.x/field.x+field.w, confirmed
// against its own LEFT_WALL_OFFSET/RIGHT_WALL_OFFSET_X_PAD/WALL_SAMPLE_RADIUS), while ResultOCR's
// own RESULT_BOX_OFFSET/TOPOUT_OFFSET are both confirmed to stay entirely within the interior's
// own bounds. FIELD_MARGIN is comfortably generous relative to that measured ~9px/~8px need.
export const FIELD_MARGIN = 12;

export const CALIBRATION_REGIONS = {
	field: {
		refPoint: { x: FIELD.x - FIELD_MARGIN, y: FIELD.y - FIELD_MARGIN },
		size: { w: FIELD.w + FIELD_MARGIN * 2, h: FIELD.h + FIELD_MARGIN * 2 },
		// the true playfield interior's own position within its own margin-padded captured
		// canvas -- what BoardOCR/ScreenOCR/ResultOCR get called with instead of today's FIELD.
		local: { x: FIELD_MARGIN, y: FIELD_MARGIN, w: FIELD.w, h: FIELD.h },
	},
	next_pill: {
		refPoint: { x: NEXT_PILL.x, y: NEXT_PILL.y },
		size: { w: CELL_SIZE * 2, h: 7 },
		local: { x: 0, y: 0 },
	},
	// top/score/level/virus/speed's `local` nests coordinates under `crop` (rather than flat
	// x/y/w/h like field/next_pill above) because that's the shape PanelOCR.readNumber()/
	// readSpeed() actually take (`location.crop.x`/etc, `location.pattern`) -- matching
	// REFERENCE_LOCATIONS' own existing shape exactly, just with crop.x/y zeroed to be local to
	// this region's own captured canvas instead of an offset into the shared 256x224 frame.
	top: {
		refPoint: {
			x: REFERENCE_LOCATIONS.top.crop.x,
			y: REFERENCE_LOCATIONS.top.crop.y,
		},
		size: {
			w: REFERENCE_LOCATIONS.top.crop.w,
			h: REFERENCE_LOCATIONS.top.crop.h,
		},
		local: {
			crop: {
				x: 0,
				y: 0,
				w: REFERENCE_LOCATIONS.top.crop.w,
				h: REFERENCE_LOCATIONS.top.crop.h,
			},
			pattern: REFERENCE_LOCATIONS.top.pattern,
		},
	},
	score: {
		refPoint: {
			x: REFERENCE_LOCATIONS.score.crop.x,
			y: REFERENCE_LOCATIONS.score.crop.y,
		},
		size: {
			w: REFERENCE_LOCATIONS.score.crop.w,
			h: REFERENCE_LOCATIONS.score.crop.h,
		},
		local: {
			crop: {
				x: 0,
				y: 0,
				w: REFERENCE_LOCATIONS.score.crop.w,
				h: REFERENCE_LOCATIONS.score.crop.h,
			},
			pattern: REFERENCE_LOCATIONS.score.pattern,
		},
	},
	level: {
		refPoint: {
			x: REFERENCE_LOCATIONS.level.crop.x,
			y: REFERENCE_LOCATIONS.level.crop.y,
		},
		size: {
			w: REFERENCE_LOCATIONS.level.crop.w,
			h: REFERENCE_LOCATIONS.level.crop.h,
		},
		local: {
			crop: {
				x: 0,
				y: 0,
				w: REFERENCE_LOCATIONS.level.crop.w,
				h: REFERENCE_LOCATIONS.level.crop.h,
			},
			pattern: REFERENCE_LOCATIONS.level.pattern,
		},
	},
	virus: {
		refPoint: {
			x: REFERENCE_LOCATIONS.virus.crop.x,
			y: REFERENCE_LOCATIONS.virus.crop.y,
		},
		size: {
			w: REFERENCE_LOCATIONS.virus.crop.w,
			h: REFERENCE_LOCATIONS.virus.crop.h,
		},
		local: {
			crop: {
				x: 0,
				y: 0,
				w: REFERENCE_LOCATIONS.virus.crop.w,
				h: REFERENCE_LOCATIONS.virus.crop.h,
			},
			pattern: REFERENCE_LOCATIONS.virus.pattern,
		},
	},
	speed: {
		refPoint: {
			x: REFERENCE_LOCATIONS.speed.crop.x,
			y: REFERENCE_LOCATIONS.speed.crop.y,
		},
		size: {
			w: REFERENCE_LOCATIONS.speed.crop.w,
			h: REFERENCE_LOCATIONS.speed.crop.h,
		},
		local: {
			crop: {
				x: 0,
				y: 0,
				w: REFERENCE_LOCATIONS.speed.crop.w,
				h: REFERENCE_LOCATIONS.speed.crop.h,
			},
			kind: REFERENCE_LOCATIONS.speed.kind,
			values: REFERENCE_LOCATIONS.speed.values,
		},
	},
};

// Versus-mode geometry, measured off tests/fixtures/dr_mario/versus_reference.png the same way
// everything above was measured off single-player captures. Both bottles use the exact same
// y/h as single-player's FIELD (the neck-to-body transition and bottle floor haven't moved),
// just narrower and shifted to make room for a bottle on each side -- so BoardOCR.js's virus
// and pill templates (see templates.js) apply completely unchanged, only the field origin
// differs.
export const VERSUS = {
	BOTTLE_1P: { x: 32, y: FIELD.y, w: FIELD.w, h: FIELD.h },
	BOTTLE_2P: { x: 160, y: FIELD.y, w: FIELD.w, h: FIELD.h },

	// Each player's next-pill preview sits in their own bottle's neck (there's no Mario
	// portrait in this layout). Same shape/color matching as single-player's NEXT_PILL, just a
	// different position -- see BoardOCR.identifyNextPill()'s `position` option.
	NEXT_PILL_1P: { x: 56, y: 44 },
	NEXT_PILL_2P: { x: 184, y: 44 },

	// The round-wins tracker between the two bottles: a 2-column (1P left, 2P right) x 3-row
	// grid, each cell either blank or holding a crown icon (see crownTemplates.js). Row 0 is the
	// top row; which row fills first as a player wins rounds hasn't been observed (only one
	// crown -- bottom-left, i.e. col 0 row 2 -- has been seen so far), so CrownOCR.js reports a
	// win *count* per player (how many of their 3 cells are filled) rather than assuming a fill
	// order.
	CROWN_GRID: {
		cols: 2,
		rows: 3,
		// top-left corner of column 0 / row 0's cell interior; col1 = col0.x + colPitch, etc.
		x: 113,
		y: 89,
		cellW: 14,
		cellH: 14,
		colPitch: 16,
		rowPitch: 16,
	},
};

// Digit/word fields for versus mode: same idea as single-player's REFERENCE_LOCATIONS, but
// LEVEL/SPEED/VIRUS each hold two values side by side (1P then 2P) instead of one, and there's
// no TOP/SCORE at all.
export const REFERENCE_LOCATIONS_VERSUS = {
	field_1p: { crop: VERSUS.BOTTLE_1P },
	field_2p: { crop: VERSUS.BOTTLE_2P },
	next_pill_1p: {
		crop: { x: VERSUS.NEXT_PILL_1P.x, y: VERSUS.NEXT_PILL_1P.y, w: 15, h: 7 },
	},
	next_pill_2p: {
		crop: { x: VERSUS.NEXT_PILL_2P.x, y: VERSUS.NEXT_PILL_2P.y, w: 15, h: 7 },
	},
	level_1p: { crop: { x: 110, y: 36, w: 15, h: 7 }, pattern: 'DD' },
	level_2p: { crop: { x: 132, y: 36, w: 15, h: 7 }, pattern: 'DD' },
	speed_1p: {
		crop: { x: 96, y: 48, w: 23, h: 7 },
		kind: 'enum',
		values: ['low', 'med', 'hi'],
	},
	speed_2p: {
		crop: { x: 136, y: 48, w: 23, h: 7 },
		kind: 'enum',
		values: ['low', 'med', 'hi'],
	},
	virus_1p: { crop: { x: 110, y: 184, w: 15, h: 7 }, pattern: 'DD' },
	virus_2p: { crop: { x: 131, y: 184, w: 15, h: 7 }, pattern: 'DD' },
};

export const CONFIGS = {
	[LAYOUT.SINGLE_PLAYER]: {
		layout: LAYOUT.SINGLE_PLAYER,
		reference: '/producer/drmario/reference_ui_single_player.png',
		fields: ['field', 'next_pill', 'top', 'score', 'level', 'virus', 'speed'],
	},
	[LAYOUT.VERSUS]: {
		layout: LAYOUT.VERSUS,
		reference: '/producer/drmario/reference_ui_versus.png',
		fields: [
			'field_1p',
			'field_2p',
			'next_pill_1p',
			'next_pill_2p',
			'level_1p',
			'level_2p',
			'speed_1p',
			'speed_2p',
			'virus_1p',
			'virus_2p',
		],
	},
};
