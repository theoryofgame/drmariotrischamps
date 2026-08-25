// Identifies the contents of each cell of a Dr. Mario bottle from raw pixel data.
//
// This module is intentionally DOM-free (no canvas/ImageData/document usage) so it can run
// both in the browser capture pipeline and directly under Jest. It expects an "image" as a
// plain { width, height, data } object, where `data` is an RGBA byte buffer in row-major order
// (i.e. structurally compatible with a browser ImageData, but not required to be one).
//
// See templates.js for why cell identification works by shape-matching against known NES tile
// silhouettes rather than by sampling a flat color per cell (which is how the Tetris OCR does
// it -- see ../cpuTetrisOCR.js's scanField()).

import {
	COLS,
	ROWS,
	CELL_SIZE,
	FIELD,
	NEXT_PILL,
	COLOR_PALETTE,
} from './constants.js';
import { CELL_TEMPLATES } from './templates.js';
import {
	sampleRegion,
	trimToContent,
	matchBestTemplate,
} from './shapeMatch.js';

function nearestPaletteColor(rgb) {
	let best = null;

	for (const [name, ref] of Object.entries(COLOR_PALETTE)) {
		const dist =
			(rgb[0] - ref[0]) ** 2 + (rgb[1] - ref[1]) ** 2 + (rgb[2] - ref[2]) ** 2;

		if (!best || dist < best.dist) {
			best = { name, dist };
		}
	}

	return best.name;
}

// Determines a pill's color from the dominant hue among its lit pixels. Pill shapes are
// color-independent (see templates.js), so unlike viruses this can't be inferred from the
// matched shape and has to be sampled directly.
function sampleDominantColor(trimmedGrid) {
	const totals = { red: 0, blue: 0, yellow: 0 };

	for (const row of trimmedGrid) {
		for (const pixel of row) {
			if (!pixel.lit) continue;
			totals[nearestPaletteColor(pixel.rgb)]++;
		}
	}

	return Object.entries(totals).sort((a, b) => b[1] - a[1])[0][0];
}

// Default maximum acceptable mismatch count before a shape match is trusted. Chosen generously
// relative to the ~25-45 lit pixels a typical template has; a genuine match against a clean
// capture should score 0, this mainly guards against capture noise once this module is wired
// into a real (noisy) video pipeline rather than the clean emulator captures it was built from.
const DEFAULT_MAX_DISTANCE = 6;

// Core matcher, shared by identifyCell() (an 8x16 grid position inside the bottle) and
// identifyNextPill() (a fixed screen position that isn't part of that grid at all -- the pill
// held above Dr. Mario's head previewing what comes after the piece currently in play). Both
// read a tile at some absolute pixel position and match it the same way; only the sampled
// height (see identifyNextPill()) and the caller-supplied `extra` fields (col/row vs. slot)
// differ.
function identifyTile(image, tileX, tileY, options, extra) {
	const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
	const height = options.height ?? CELL_SIZE;

	const grid = sampleRegion(image, tileX, tileY, CELL_SIZE, height);
	const trimmed = trimToContent(grid);

	if (!trimmed) {
		return { type: 'empty', ...extra };
	}

	const litGrid = trimmed.map(r => r.map(p => p.lit));
	const { template, distance } = matchBestTemplate(litGrid, CELL_TEMPLATES);

	if (distance > maxDistance) {
		return { type: 'unknown', ...extra, distance, bestGuess: template.id };
	}

	if (template.kind === 'virus') {
		return {
			type: 'virus',
			color: template.color,
			frame: template.frame,
			...extra,
			distance,
		};
	}

	if (template.kind === 'clearing') {
		// Whatever was here (virus or pill) is no longer visually distinguishable once it starts
		// clearing -- both render this same hollow-ring shape (see templates.js) -- only color
		// survives.
		return {
			type: 'clearing',
			color: sampleDominantColor(trimmed),
			...extra,
			distance,
		};
	}

	return {
		type: 'pill',
		shape: template.shape,
		color: sampleDominantColor(trimmed),
		...extra,
		distance,
	};
}

// `options.field` lets this target a bottle other than single-player's centered one -- versus
// mode has two, side by side (see constants.js VERSUS.BOTTLE_1P / BOTTLE_2P), at the same
// vertical geometry (y/h) but different x origins.
export function identifyCell(image, col, row, options = {}) {
	const field = options.field ?? FIELD;
	const cellX = field.x + col * CELL_SIZE;
	const cellY = field.y + row * CELL_SIZE;

	return identifyTile(image, cellX, cellY, options, { col, row });
}

// Reads a next-pill preview: two cells, always rendered as a horizontal pill (a 'left' shape
// next to a 'right' shape, using the exact same sprites as an in-bottle horizontal pill -- see
// templates.js) regardless of what orientation the pill will actually spawn in, so shape isn't
// informative here, only each half's color is. `options.position` lets this target either
// player's preview in versus mode (constants.js VERSUS.NEXT_PILL_1P / NEXT_PILL_2P); it
// defaults to single-player's, where this is the pill Dr. Mario holds above his head.
// Confirmed (single-player) via real captures to differ from the currently-falling piece --
// it's a preview of what's coming *after* it -- and to stay constant across frames while the
// current piece is still in play.
export function identifyNextPill(image, options = {}) {
	const position = options.position ?? NEXT_PILL;
	// height: 7, not the full CELL_SIZE (8) -- the row right below this preview isn't blank
	// padding like it is for a bottle cell (it's the top of Dr. Mario's hat in single-player, or
	// the neck's decorative bevel in versus mode), so sampling a full cell here would
	// occasionally pull in a stray lit pixel from it.
	const tileOptions = { ...options, height: 7 };

	return {
		left: identifyTile(image, position.x, position.y, tileOptions, {
			slot: 'left',
		}),
		right: identifyTile(
			image,
			position.x + CELL_SIZE,
			position.y,
			tileOptions,
			{ slot: 'right' }
		),
	};
}

export function scanBoard(image, options = {}) {
	const board = [];

	for (let row = 0; row < ROWS; row++) {
		const boardRow = [];

		for (let col = 0; col < COLS; col++) {
			boardRow.push(identifyCell(image, col, row, options));
		}

		board.push(boardRow);
	}

	return board;
}
