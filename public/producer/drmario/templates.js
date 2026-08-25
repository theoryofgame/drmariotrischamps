// Shape templates for the contents of a single Dr. Mario bottle cell.
//
// Each template is a small grid of rows (up to CELL_SIZE - 1 = 7 columns/rows, since NES tiles
// in this game are drawn with at least a 1px transparent margin against the cell grid). A '.'
// means "background" (unlit); any other character means "part of the sprite" (lit). The actual
// letter used for lit pixels is irrelevant to matching -- only the lit/unlit silhouette matters
// -- it's kept as a rough color mnemonic (R/B/Y) purely to make this file readable/diffable.
//
// Templates were hand-derived from real emulator captures (see tests/fixtures/dr_mario) by
// dumping exact per-pixel colors and cross-checking multiple independent instances of each
// shape. Two things fell out of that process that shaped this design:
//
// 1. Each virus color has its own distinct body shape in this game (red is a round amoeba,
//    blue has an antenna, yellow is spiky), not just a different hue on a shared shape. So a
//    virus's color and its 2-frame idle animation can both be read directly off of which shape
//    template matched, with no separate color sampling needed.
// 2. Pill segments are the opposite: all 3 colors render the exact same 5 shapes (a pill's
//    color carries no shape information), so pill color has to be sampled separately from
//    whichever pixels the matched shape says are "lit" (see BoardOCR.js).
//
// Observed rendering also isn't perfectly grid-locked: a shape's content can start flush at the
// top of its cell or be shifted down by 1px, seemingly per-instance rather than by piece state.
// Templates below are stored trimmed of any blank leading/trailing rows, and BoardOCR.js aligns
// a sampled cell against them at whichever vertical offset scores best, rather than assuming a
// fixed offset.

export const VIRUS_TEMPLATES = [
	{
		id: 'virus_red_0',
		color: 'red',
		frame: 0,
		rows: [
			'Y.RRR..',
			'.R...RY',
			'R.B.B.R',
			'RRRRRRR',
			'R.Y.Y.R',
			'.R...RB',
			'B.RRR..',
		],
	},
	{
		id: 'virus_red_1',
		color: 'red',
		frame: 1,
		rows: [
			'..RRR.Y',
			'YR...R.',
			'R.B.B.R',
			'RRRRRRR',
			'R.Y.Y.R',
			'BR...R.',
			'..RRR.B',
		],
	},
	{
		id: 'virus_blue_0',
		color: 'blue',
		frame: 0,
		rows: [
			'BB...BB',
			'..BBB..',
			'...B...',
			'B.Y.Y.B',
			'BBBBBBB',
			'B..Y..B',
			'.BBBBB.',
		],
	},
	{
		id: 'virus_blue_1',
		color: 'blue',
		frame: 1,
		rows: ['.BBBBB.', 'BB.B.BB', 'B.Y.Y.B', 'BBBBBBB', 'BB.Y.BB', '.B...B.'],
	},
	{
		id: 'virus_yellow_0',
		color: 'yellow',
		frame: 0,
		rows: [
			'..B.B..',
			'Y.YYY.Y',
			'.Y...Y.',
			'..B.B..',
			'.YYYYY.',
			'.YYRYY.',
			'..YRY..',
		],
	},
	{
		id: 'virus_yellow_1',
		color: 'yellow',
		frame: 1,
		rows: [
			'..B.B..',
			'Y.YYY.Y',
			'.Y...Y.',
			'YYB.BYY',
			'YYYYYYY',
			'Y.....Y',
			'.YYYYY.',
		],
	},
];

// Pill shapes are color-independent: the same 5 silhouettes are reused for red/blue/yellow.
// 'left'/'right' are the two halves of a landed horizontal pill; 'top'/'bottom' the two halves
// of a landed vertical pill; 'single' is a lone half left standing once its other half has been
// cleared away elsewhere (rounded on every side, unlike 'top'/'bottom'/'left'/'right' which are
// each flat on the side that used to connect to their other half).
export const PILL_SHAPE_TEMPLATES = [
	{
		id: 'pill_left',
		shape: 'left',
		rows: [
			'.RRRRRR',
			'RRYYYYR',
			'RYRRRRR',
			'RRRRRRR',
			'RRRRRRR',
			'RRRRRRR',
			'.RRRRRR',
		],
	},
	{
		id: 'pill_right',
		shape: 'right',
		rows: [
			'BBBBBB.',
			'YYYYYBB',
			'BBBBBBB',
			'BBBBBBB',
			'BBBBBBB',
			'BBBBBBB',
			'BBBBBB.',
		],
	},
	{
		id: 'pill_top',
		shape: 'top',
		rows: [
			'.BBBBB.',
			'BBYBBBB',
			'BYBBBBB',
			'BYBBBBB',
			'BYBBBBB',
			'BYBBBBB',
			'BBBBBBB',
		],
	},
	{
		id: 'pill_bottom',
		shape: 'bottom',
		rows: [
			'RYRRRRR',
			'RYRRRRR',
			'RYRRRRR',
			'RYRRRRR',
			'RYRRRRR',
			'RRRRRRR',
			'.RRRRR.',
		],
	},
	{
		id: 'pill_single',
		shape: 'single',
		rows: [
			'.RRRRR.',
			'RRYRRRR',
			'RYRRRRR',
			'RYRRRRR',
			'RYRRRRR',
			'RRRRRRR',
			'.RRRRR.',
		],
	},
];

export const CELL_TEMPLATES = [
	...VIRUS_TEMPLATES.map(t => ({ ...t, kind: 'virus' })),
	...PILL_SHAPE_TEMPLATES.map(t => ({ ...t, kind: 'pill' })),
];
