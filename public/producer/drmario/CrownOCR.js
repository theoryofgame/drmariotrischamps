// Reads the versus-mode round-wins "crowns" grid from raw pixel data. Same DOM-free
// { width, height, data } image shape as BoardOCR.js/PanelOCR.js; see shapeMatch.js for the
// shared sampling/matching machinery all three modules build on.

import { VERSUS } from './constants.js';
import { CROWN_TEMPLATE } from './crownTemplates.js';
import {
	sampleRegion,
	trimToContent,
	matchBestTemplate,
} from './shapeMatch.js';

// A clean match should score 0 (see crownTemplates.js); this only exists to leave room for
// capture noise later.
const DEFAULT_MAX_DISTANCE = 6;

function hasCrown(image, cellX, cellY, options) {
	const { CROWN_GRID } = VERSUS;
	const grid = sampleRegion(
		image,
		cellX,
		cellY,
		CROWN_GRID.cellW,
		CROWN_GRID.cellH
	);
	const trimmed = trimToContent(grid);

	if (!trimmed) return false; // empty cell: no crown

	const litGrid = trimmed.map(row => row.map(p => p.lit));
	const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
	const { distance } = matchBestTemplate(litGrid, [CROWN_TEMPLATE]);

	return distance <= maxDistance;
}

// Reads one player's column of the crown grid (col 0 for 1P, col 1 for 2P). Returns
// { cells, wins }: `cells` is the 3 row states top-to-bottom, `wins` is just how many of them
// are filled -- which row fills first as a player wins rounds hasn't been observed yet (see
// constants.js VERSUS.CROWN_GRID), so this deliberately doesn't assume a fill order.
function readColumn(image, col, options) {
	const { CROWN_GRID } = VERSUS;
	const cells = [];

	for (let row = 0; row < CROWN_GRID.rows; row++) {
		const cellX = CROWN_GRID.x + col * CROWN_GRID.colPitch;
		const cellY = CROWN_GRID.y + row * CROWN_GRID.rowPitch;
		cells.push(hasCrown(image, cellX, cellY, options));
	}

	return { cells, wins: cells.filter(Boolean).length };
}

export function readCrowns(image, options = {}) {
	return {
		player1: readColumn(image, 0, options),
		player2: readColumn(image, 1, options),
	};
}
