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
