// Templates for the score-panel text: the digit font used by TOP/SCORE/LEVEL/VIRUS, and the
// SPEED word (LOW/MED/HI -- not digits, so it's matched as a single whole-word shape rather
// than character by character).
//
// Derived the same way templates.js was: dumping exact per-pixel colors off real captures (see
// tests/fixtures/dr_mario) and cross-checking multiple independent instances of each glyph.
// Every digit template below was confirmed pixel-identical across at least two occurrences in
// different fields/captures (e.g. '0' from TOP, SCORE, LEVEL and VIRUS all agree; '4' from
// VIRUS in two different captures agrees; '5' from LEVEL and VIRUS agrees), so this is a
// standard fixed bitmap font, not something that varies by field or context.
//
// Unlike bottle cells (see templates.js), no vertical jitter was observed in this UI text --
// every digit and word instance sampled cleanly at the same offset -- so these templates don't
// need the alignment tolerance bottle-cell matching relies on, though PanelOCR.js reuses the
// same matching machinery anyway for consistency (and because it costs nothing against clean
// captures).

export const DIGIT_TEMPLATES = [
	{
		id: 'digit_0',
		value: 0,
		rows: [
			'..XXX..',
			'.X..XX.',
			'XX...XX',
			'XX...XX',
			'XX...XX',
			'.XX..X.',
			'..XXX..',
		],
	},
	{
		id: 'digit_1',
		value: 1,
		rows: [
			'...XX..',
			'..XXX..',
			'...XX..',
			'...XX..',
			'...XX..',
			'...XX..',
			'.XXXXXX',
		],
	},
	{
		id: 'digit_2',
		value: 2,
		rows: [
			'.XXXXX.',
			'XX...XX',
			'....XXX',
			'..XXXX.',
			'.XXXX..',
			'XXX....',
			'XXXXXXX',
		],
	},
	{
		id: 'digit_3',
		value: 3,
		rows: [
			'.XXXXXX',
			'....XX.',
			'...XX..',
			'..XXXX.',
			'.....XX',
			'XX...XX',
			'.XXXXX.',
		],
	},
	{
		id: 'digit_4',
		value: 4,
		rows: [
			'...XXX.',
			'..XXXX.',
			'.XX.XX.',
			'XX..XX.',
			'XXXXXXX',
			'....XX.',
			'....XX.',
		],
	},
	{
		id: 'digit_5',
		value: 5,
		rows: [
			'XXXXXX.',
			'XX.....',
			'XXXXXX.',
			'.....XX',
			'.....XX',
			'XX...XX',
			'.XXXXX.',
		],
	},
	{
		id: 'digit_6',
		value: 6,
		rows: [
			'..XXXX.',
			'.XX....',
			'XX.....',
			'XXXXXX.',
			'XX...XX',
			'XX...XX',
			'.XXXXX.',
		],
	},
	{
		id: 'digit_7',
		value: 7,
		rows: [
			'XXXXXXX',
			'XX...XX',
			'....XX.',
			'...XX..',
			'..XX...',
			'..XX...',
			'..XX...',
		],
	},
	{
		id: 'digit_8',
		value: 8,
		rows: [
			'.XXXXX.',
			'XX...XX',
			'XX...XX',
			'.XXXXX.',
			'XX...XX',
			'XX...XX',
			'.XXXXX.',
		],
	},
	{
		id: 'digit_9',
		value: 9,
		rows: [
			'.XXXXX.',
			'XX...XX',
			'XX...XX',
			'.XXXXXX',
			'.....XX',
			'....XX.',
			'.XXXX..',
		],
	},
];

// Each row is 23 characters wide (the full measured SPEED value crop), not per-letter -- with
// only 3 possible values, matching the whole word at once is simpler than segmenting it into
// individual letter glyphs.
export const SPEED_TEMPLATES = [
	{
		id: 'speed_low',
		value: 'low',
		rows: [
			'.XX......XXXXX..XX...XX',
			'.XX.....XX...XX.XX...XX',
			'.XX.....XX...XX.XX.X.XX',
			'.XX.....XX...XX.XXXXXXX',
			'.XX.....XX...XX.XXXXXXX',
			'.XX.....XX...XX.XXX.XXX',
			'.XXXXXX..XXXXX..XX...XX',
		],
	},
	{
		id: 'speed_med',
		value: 'med',
		rows: [
			'XX...XX.XXXXXXX.XXXXX..',
			'XXX.XXX.XX......XX..XX.',
			'XXXXXXX.XX......XX...XX',
			'XXXXXXX.XXXXXX..XX...XX',
			'XX.X.XX.XX......XX...XX',
			'XX...XX.XX......XX..XX.',
			'XX...XX.XXXXXXX.XXXXX..',
		],
	},
	{
		id: 'speed_hi',
		value: 'hi',
		rows: [
			'........XX...XX..XXXXXX',
			'........XX...XX....XX..',
			'........XX...XX....XX..',
			'........XXXXXXX....XX..',
			'........XX...XX....XX..',
			'........XX...XX....XX..',
			'........XX...XX..XXXXXX',
		],
	},
];
