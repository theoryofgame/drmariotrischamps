// Shared pixel-sampling and shape-matching primitives, used by both BoardOCR.js (bottle cells,
// the next-pill preview) and PanelOCR.js (score/level/virus digits, the speed word). Both read
// some rectangle of pixels, reduce it to a lit/unlit silhouette, and match that silhouette
// against a bank of known templates -- only what counts as "lit", and which templates are in
// play, differ between the two.

// Comfortably separates near-black (0) from anything bright (bottle sprite colors, or the
// score panel's light lavender background) -- both readings below use this same threshold,
// just on opposite sides of it (see `invert` on sampleRegion()).
const LIT_LUMA_THRESHOLD = 24;

export function luma(r, g, b) {
	return r * 0.299 + g * 0.587 + b * 0.114;
}

export function getPixel(image, x, y) {
	const idx = (y * image.width + x) << 2;
	return [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
}

// Samples a width x height rectangle of pixels into a grid of { lit, rgb }. "lit" means bright
// (a sprite pixel against the bottle's black background) unless `invert` is set, which means
// dark instead -- the score panel is the opposite arrangement, black text on a light
// background, so PanelOCR.js reads it with invert: true.
export function sampleRegion(
	image,
	regionX,
	regionY,
	width,
	height,
	invert = false
) {
	const grid = [];

	for (let y = 0; y < height; y++) {
		const row = [];

		for (let x = 0; x < width; x++) {
			const rgb = getPixel(image, regionX + x, regionY + y);
			const bright = luma(...rgb) > LIT_LUMA_THRESHOLD;
			row.push({ lit: invert ? !bright : bright, rgb });
		}

		grid.push(row);
	}

	return grid;
}

// Finds the bounding box of "lit" pixels in a sampled grid, and returns just that sub-grid.
// Sampled regions are deliberately oversized relative to their real content (see callers), and
// real NES tile/text art in this game isn't always flush against every edge of its nominal
// cell, so content is always compared to templates by shape/bounding box rather than by raw
// fixed offset.
export function trimToContent(grid) {
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

	if (top === -1) return null; // nothing lit

	return grid.slice(top, bottom + 1).map(row => row.slice(left, right + 1));
}

export function charRowToLitRow(charRow) {
	return charRow.split('').map(ch => ch !== '.');
}

// Counts mismatches between two boolean grids, trying every offset at which the smaller grid
// fits within the larger one along both axes, and keeping the best (lowest-mismatch) offset.
// This absorbs small per-instance alignment jitter (e.g. content shifted by a row) rather than
// requiring pixel-exact framing.
export function bestAlignedMismatchCount(gridA, gridB) {
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

// Matches a lit/unlit grid against a bank of { id, rows, ...meta } templates (rows being '.'
// for unlit / anything else for lit, as in templates.js and digitTemplates.js), returning the
// closest template and its mismatch distance.
export function matchBestTemplate(litGrid, templates) {
	let best = null;

	for (const template of templates) {
		const templateGrid = template.rows.map(charRowToLitRow);
		const distance = bestAlignedMismatchCount(litGrid, templateGrid);

		if (!best || distance < best.distance) {
			best = { template, distance };
		}
	}

	return best;
}
