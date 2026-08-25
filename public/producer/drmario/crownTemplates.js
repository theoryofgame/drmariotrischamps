// Shape template for a "crown" icon in the versus-mode round-wins grid (see constants.js
// VERSUS.CROWN_GRID). Derived the same way as templates.js/digitTemplates.js: dumping exact
// per-pixel colors off a real capture (tests/fixtures/dr_mario/versus_reference.png).
//
// Only one shape is needed, not "won"/"not won" pairs like virus animation frames: a crown is
// drawn with a fixed silhouette using yellow (constant) plus 2 pixels that alternate between
// red and blue as its only animation (confirmed by direct observation of the live capture this
// was sourced from -- not something this single still frame could show on its own). Since the
// red/blue pixels are lit either way, matching lit/unlit shape rather than color makes this
// template naturally animation-frame-independent: there's nothing to special-case.
export const CROWN_TEMPLATE = {
	id: 'crown',
	rows: [
		'.....XX.....',
		'.....XX.....',
		'....XXXX....',
		'...X....X...',
		'X....XX....X',
		'XX.X.XX.X.XX',
		'X.XX....XX.X',
		'X...X..X...X',
		'.XXXXXXXXXX.',
		'XXXXXXXXXXXX',
		'XXXXXXXXXXXX',
	],
};
