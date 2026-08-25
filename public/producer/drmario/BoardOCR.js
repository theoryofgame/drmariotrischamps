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

const LIT_LUMA_THRESHOLD = 24; // background is pure black; any real sprite pixel reads well above this

function luma(r, g, b) {
	return r * 0.299 + g * 0.587 + b * 0.114;
}

function getPixel(image, x, y) {
	const idx = (y * image.width + x) << 2;
	return [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
}

// Samples one cell into a CELL_SIZE x height grid of { lit, rgb } pixels. height defaults to
// CELL_SIZE (a full bottle cell); identifyNextPill() overrides it to stop 1 row short of a full
// cell, because unlike a bottle cell -- always padded with blank rows below its content -- the
// row right after the next-pill preview isn't padding, it's the top of Dr. Mario's hat.
function sampleCell(image, cellX, cellY, height = CELL_SIZE) {
	const grid = [];

	for (let y = 0; y < height; y++) {
		const row = [];

		for (let x = 0; x < CELL_SIZE; x++) {
			const rgb = getPixel(image, cellX + x, cellY + y);
			row.push({ lit: luma(...rgb) > LIT_LUMA_THRESHOLD, rgb });
		}

		grid.push(row);
	}

	return grid;
}

// Finds the bounding box of "lit" pixels in a sampled cell grid, and returns just that
// sub-grid. Real NES tile art in this game is never drawn flush against all 4 edges of its
// 8x8 cell, and (per templates.js) the same shape can render with its content shifted by a
// row depending on the instance, so content is always compared to templates by shape/bounding
// box rather than by raw fixed cell offset.
function trimToContent(grid) {
	let top = -1,
		bottom = -1,
		left = -1,
		right = -1;

	for (let y = 0; y < grid.length; y++) {
		for (let x = 0; x < grid[y].length; x++) {
			if (!grid[y][x].lit) continue;

			if (top === -1) top = y;
			bottom = y;
			if (left === -1 || x < left) left = x;
			if (right === -1 || x > right) right = x;
		}
	}

	if (top === -1) return null; // nothing lit: empty cell

	return grid.slice(top, bottom + 1).map(row => row.slice(left, right + 1));
}

function charRowToLitRow(charRow) {
	return charRow.split('').map(ch => ch !== '.');
}

// Counts mismatches between two boolean grids, trying every offset at which the smaller grid
// fits within the larger one along both axes, and keeping the best (lowest-mismatch) offset.
// This is what absorbs the per-instance +/-1 row (and, defensively, column) jitter noted above.
function bestAlignedMismatchCount(gridA, gridB) {
	const [small, large] =
		gridA.length * gridA[0].length <= gridB.length * gridB[0].length
			? [gridA, gridB]
			: [gridB, gridA];

	const rowSlack = large.length - small.length;
	const colSlack = large[0].length - small[0].length;

	if (rowSlack < 0 || colSlack < 0) {
		// small doesn't actually fit inside large on some axis: fall back to comparing
		// only the overlapping region, which will naturally score as a poor match.
		let mismatches = 0;
		const h = Math.max(gridA.length, gridB.length);
		const w = Math.max(gridA[0].length, gridB[0].length);

		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const a = gridA[y]?.[x] ?? false;
				const b = gridB[y]?.[x] ?? false;
				if (a !== b) mismatches++;
			}
		}

		return mismatches;
	}

	let best = Infinity;

	for (let rowOffset = 0; rowOffset <= rowSlack; rowOffset++) {
		for (let colOffset = 0; colOffset <= colSlack; colOffset++) {
			let mismatches = 0;

			for (let y = 0; y < large.length; y++) {
				for (let x = 0; x < large[0].length; x++) {
					const inSmall =
						y >= rowOffset &&
						y < rowOffset + small.length &&
						x >= colOffset &&
						x < colOffset + small[0].length;
					const smallVal = inSmall
						? small[y - rowOffset][x - colOffset]
						: false;

					if (smallVal !== large[y][x]) mismatches++;
				}
			}

			if (mismatches < best) best = mismatches;
		}
	}

	return best;
}

function matchTemplate(litGrid) {
	let best = null;

	for (const template of CELL_TEMPLATES) {
		const templateGrid = template.rows.map(charRowToLitRow);
		const distance = bestAlignedMismatchCount(litGrid, templateGrid);

		if (!best || distance < best.distance) {
			best = { template, distance };
		}
	}

	return best;
}

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
// height (see sampleCell()) and the caller-supplied `extra` fields (col/row vs. slot) differ.
function identifyTile(image, tileX, tileY, options, extra) {
	const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;

	const grid = sampleCell(image, tileX, tileY, options.height);
	const trimmed = trimToContent(grid);

	if (!trimmed) {
		return { type: 'empty', ...extra };
	}

	const litGrid = trimmed.map(r => r.map(p => p.lit));
	const { template, distance } = matchTemplate(litGrid);

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

	return {
		type: 'pill',
		shape: template.shape,
		color: sampleDominantColor(trimmed),
		...extra,
		distance,
	};
}

export function identifyCell(image, col, row, options = {}) {
	const cellX = FIELD.x + col * CELL_SIZE;
	const cellY = FIELD.y + row * CELL_SIZE;

	return identifyTile(image, cellX, cellY, options, { col, row });
}

// Reads the next-pill preview Dr. Mario holds above his head. Always renders as a horizontal
// pill (a 'left' shape next to a 'right' shape, using the exact same sprites as an in-bottle
// horizontal pill -- see templates.js), regardless of what orientation the pill will actually
// spawn in, so shape isn't informative here: only each half's color is. Confirmed via real
// captures to differ from the currently-falling piece (it's a preview of what's coming *after*
// it), and to stay constant across frames while the current piece is still in play.
export function identifyNextPill(image, options = {}) {
	// height: 7, not the full CELL_SIZE (8) -- the row right below this preview is the top of
	// Dr. Mario's hat, not blank padding, so sampling a full cell here would occasionally pull
	// in a stray lit pixel from it (see sampleCell()).
	const tileOptions = { ...options, height: 7 };

	return {
		left: identifyTile(image, NEXT_PILL.x, NEXT_PILL.y, tileOptions, {
			slot: 'left',
		}),
		right: identifyTile(
			image,
			NEXT_PILL.x + CELL_SIZE,
			NEXT_PILL.y,
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
