// Draws a bottle cell (pill half/single, virus, or a mid-clear ring) as its real NES sprite art,
// via canvas, instead of BaseGame's flat-color/gradient placeholder rendering (see
// drmario_versus.html/drmario_single.html's older colorFor()/backgroundFor()). Built on the real
// per-pixel bitmaps in spriteBitmaps.js -- this module's only job is turning those into cached,
// pre-rendered offscreen canvases and blitting the right one per cell, scaled up with nearest-
// neighbor scaling for a crisp pixel-art look.
//
// Virus animation deliberately does NOT use the frame OCR actually read for a given cell
// (identifyCell()/scanBoard() already report one, live, per virus cell -- see BoardOCR.js) --
// discussed directly and confirmed exact sync to real gameplay isn't wanted here. Using the real
// per-cell OCR frame would also risk visible flicker under real capture jitter (see the
// hasBottle tolerance fix in ScreenOCR.js) and would let different viruses in the same bottle
// drift out of sync with each other, since each cell's frame would come from its own independent
// OCR read. currentVirusFrame() below is a single wall-clock toggle instead, shared by every
// virus cell in a redraw -- simpler, immune to OCR noise, and arguably more authentic anyway
// (the real game's viruses all animate on one shared beat, not independently).

import {
	PILL_SPRITES,
	VIRUS_SPRITES,
	PILL_TONES,
	CLEARING_PATTERN,
} from './spriteBitmaps.js';
import { CELL_SIZE } from './constants.js';

const UNKNOWN_COLOR = '#888';

function buildSpriteCanvas(bitmap) {
	const canvas = document.createElement('canvas');
	canvas.width = CELL_SIZE;
	canvas.height = CELL_SIZE;
	const ctx = canvas.getContext('2d');
	const imageData = ctx.createImageData(CELL_SIZE, CELL_SIZE);

	bitmap.forEach((row, y) => {
		row.forEach((px, x) => {
			const idx = (y * CELL_SIZE + x) << 2;
			if (px === null) {
				imageData.data[idx + 3] = 0; // transparent
			} else {
				imageData.data[idx] = px[0];
				imageData.data[idx + 1] = px[1];
				imageData.data[idx + 2] = px[2];
				imageData.data[idx + 3] = 255;
			}
		});
	});

	ctx.putImageData(imageData, 0, 0);
	return canvas;
}

function buildClearingCanvas(color) {
	const tint = PILL_TONES[color][0];
	const bitmap = CLEARING_PATTERN.map(row =>
		row.map(lit => (lit ? tint : null))
	);
	return buildSpriteCanvas(bitmap);
}

// Built once at module load -- every sprite this file can ever draw, keyed the same way drawCell
// below looks them up.
const spriteCanvases = new Map();

for (const color of ['red', 'blue', 'yellow']) {
	for (const shape of ['left', 'right', 'top', 'bottom', 'single']) {
		spriteCanvases.set(
			`pill:${color}:${shape}`,
			buildSpriteCanvas(PILL_SPRITES[color][shape])
		);
	}
	for (const frame of [0, 1]) {
		spriteCanvases.set(
			`virus:${color}:${frame}`,
			buildSpriteCanvas(VIRUS_SPRITES[color][frame])
		);
	}
	spriteCanvases.set(`clearing:${color}`, buildClearingCanvas(color));
}

// A flat, shared toggle -- not tied to any one cell's own OCR-reported frame. See this file's
// header comment for why. intervalMs is a plausible approximation, not a measured NES timing
// value (none exists in this codebase) -- purely cosmetic, adjust freely. Doubled twice from an
// initial 500ms guess (500 -> 250 -> 125ms) per direct feedback that it kept reading as too slow.
export function currentVirusFrame(intervalMs = 125) {
	return Math.floor(Date.now() / intervalMs) % 2;
}

// Draws one bottle cell into ctx at (x, y), scaled to size x size. virusFrame (0 or 1, see
// currentVirusFrame()) is required for virus cells; pass whatever currentVirusFrame() returned
// for this redraw so every virus in the same board call is drawn from the same frame.
export function drawCell(ctx, x, y, size, cell, virusFrame) {
	if (!cell || cell.type === 'empty') return;

	if (cell.type === 'unknown') {
		ctx.fillStyle = UNKNOWN_COLOR;
		ctx.fillRect(x, y, size, size);
		return;
	}

	let key;
	if (cell.type === 'pill') {
		key = `pill:${cell.color}:${cell.shape}`;
	} else if (cell.type === 'virus') {
		key = `virus:${cell.color}:${virusFrame}`;
	} else if (cell.type === 'clearing') {
		key = `clearing:${cell.color}`;
	} else {
		return;
	}

	const sprite = spriteCanvases.get(key);
	if (!sprite) return;

	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(sprite, x, y, size, size);
}
