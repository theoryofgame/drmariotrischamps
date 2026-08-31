// Wiring for harness.html: video source selection, click-to-calibrate, and a live render of
// whatever DrMarioOCR decodes each frame. See DrMarioOCR.js for the actual OCR logic -- this
// file is just DOM glue around it.

import {
	LAYOUT,
	REFERENCE_SIZE,
	COLOR_PALETTE,
	CALIBRATION_REGIONS,
} from './constants.js';
import { DrMarioOCR } from './DrMarioOCR.js';
import { deriveAllRegionsFromScreen } from './calibrationMath.js';
import RoundTracker from './RoundTracker.js';
import {
	playVideoFromDevice,
	playVideoFromScreenCap,
	getConnectedDevices,
} from '../MediaUtils.js';

const video = document.getElementById('video');
const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas.getContext('2d');
const layoutSelect = document.getElementById('layout');
const deviceSelect = document.getElementById('devices');
const results = document.getElementById('results');
const referenceHolder = document.getElementById('reference-canvas-holder');

const calInputs = {
	x: document.getElementById('cal-x'),
	y: document.getElementById('cal-y'),
	w: document.getElementById('cal-w'),
	h: document.getElementById('cal-h'),
};

const STORAGE_KEY = 'drmario_ocr_harness_calibration';

function loadCalibration() {
	let raw;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch (_err) {
		return null;
	}
	if (!raw) return null;

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (_err) {
		return null;
	}
	if (!parsed) return null;

	// Old shape (before independent per-region calibration existed): a flat {x,y,w,h} whole-
	// screen rect. Migrate it forward the same way producer.js does.
	if (!parsed.regions) {
		return { screen: parsed, regions: deriveAllRegionsFromScreen(parsed) };
	}

	return parsed;
}

function saveCalibration(calibration) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration));
	} catch (_err) {
		// ignore -- calibration just won't persist across reloads
	}
}

let calibration = loadCalibration();
const ocr = new DrMarioOCR({ layout: layoutSelect.value, calibration });

const referenceCanvas = ocr.getReferenceCanvas();
referenceCanvas.style.width = `${REFERENCE_SIZE.w * 2}px`;
referenceCanvas.style.height = `${REFERENCE_SIZE.h * 2}px`;
referenceHolder.appendChild(referenceCanvas);

// RoundTracker instances: one bottle each. Rebuilt (not just reset) on layout change since a
// player-1-vs-player-2 pair only makes sense once you're actually in versus mode.
const eventLog = document.getElementById('event-log');
const MAX_LOG_LINES = 100;
let trackers = {};

function formatDetailValue(key, value) {
	// piece_entered's and garbage_entered's `cells` are both arrays of { col, shape, color } --
	// the generic k=v stringification below would just print "[object Object]" for them.
	if (key === 'cells' && Array.isArray(value)) {
		return value.map(c => `col${c.col}:${c.shape}:${c.color}`).join(',');
	}
	return value;
}

function logTrackerEvent(label, event) {
	const line = document.createElement('div');
	const detail = Object.entries(event.detail)
		.map(([k, v]) => `${k}=${formatDetailValue(k, v)}`)
		.join(' ');
	line.textContent = `[${label}] ${event.type} ${detail}`;
	eventLog.prepend(line);
	while (eventLog.childElementCount > MAX_LOG_LINES) {
		eventLog.removeChild(eventLog.lastChild);
	}
}

function wireTracker(tracker, label) {
	[
		'round_start',
		'round_level_confirmed',
		'round_ready',
		'round_end',
		'piece_entered',
		'garbage_entered',
	].forEach(type => {
		tracker.addEventListener(type, event => logTrackerEvent(label, event));
	});
}

function buildTrackers() {
	eventLog.innerHTML = '';

	if (layoutSelect.value === LAYOUT.VERSUS) {
		trackers = { player1: new RoundTracker(), player2: new RoundTracker() };
		wireTracker(trackers.player1, '1P');
		wireTracker(trackers.player2, '2P');

		// Versus mode's round boundary is shared -- one player winning/losing ends the round for
		// both -- but each tracker only sees its own bottle, so it can't notice that on its own.
		// Propagate one's round_end onto the other; endRound() is a no-op if that tracker's own
		// result already ended its round, so this can't double-fire or loop between the two.
		trackers.player1.addEventListener('round_end', event =>
			trackers.player2.endRound(`opponent_${event.detail.outcome}`)
		);
		trackers.player2.addEventListener('round_end', event =>
			trackers.player1.endRound(`opponent_${event.detail.outcome}`)
		);

		// Same idea for the next round's start: the bottle that ended via endRound() (not its own
		// result) waits for the other's own real round_start rather than self-detecting off its
		// own frame data, which can already look like a new round before the affected bottle's own
		// win/loss overlay has even cleared. syncRoundStart() is a no-op unless that tracker is
		// actually waiting for one, so this can't clobber a tracker that started on its own. Only
		// roundId is forwarded, deliberately -- each player's level is set independently, so level
		// must never be borrowed from the other tracker (syncRoundStart() ignores it even if
		// passed; only roundId is pulled out here to make that unambiguous at the call site too).
		trackers.player1.addEventListener('round_start', event =>
			trackers.player2.syncRoundStart({ roundId: event.detail.roundId })
		);
		trackers.player2.addEventListener('round_start', event =>
			trackers.player1.syncRoundStart({ roundId: event.detail.roundId })
		);
	} else {
		trackers = { single: new RoundTracker() };
		wireTracker(trackers.single, 'SP');
	}
}
buildTrackers();

function updateCalInputs() {
	const screen = calibration?.screen;
	calInputs.x.value = screen ? Math.round(screen.x) : '';
	calInputs.y.value = screen ? Math.round(screen.y) : '';
	calInputs.w.value = screen ? Math.round(screen.w) : '';
	calInputs.h.value = screen ? Math.round(screen.h) : '';
}
updateCalInputs();

// One small box per CALIBRATION_REGIONS entry -- see producer.js's own identical setup for the
// full reasoning (this mirrors it directly, minus the bottle-anchored quick-seed mode, which
// isn't ported here to keep this testing tool's own diff smaller).
const regionCalibrationContainer =
	document.getElementById('region-calibration');
const REGION_PREVIEW_SCALE = 3;
const regionInputs = {};
const PANEL_FIELD_NAMES = ['top', 'score', 'level', 'virus', 'speed'];
const regionDebugEls = {};

// field is the only region with a margin at all -- see producer.js's own identical setup for the
// full reasoning (this mirrors it directly).
function applyFieldPreviewCrop(previewHolder, canvas, hideMargin) {
	const { local, size } = CALIBRATION_REGIONS.field;

	if (hideMargin) {
		previewHolder.style.width = `${local.w * REGION_PREVIEW_SCALE}px`;
		previewHolder.style.height = `${local.h * REGION_PREVIEW_SCALE}px`;
		canvas.style.marginLeft = `${-local.x * REGION_PREVIEW_SCALE}px`;
		canvas.style.marginTop = `${-local.y * REGION_PREVIEW_SCALE}px`;
	} else {
		previewHolder.style.width = `${size.w * REGION_PREVIEW_SCALE}px`;
		previewHolder.style.height = `${size.h * REGION_PREVIEW_SCALE}px`;
		canvas.style.marginLeft = '0';
		canvas.style.marginTop = '0';
	}
}

Object.entries(CALIBRATION_REGIONS).forEach(([name, { size }]) => {
	const box = document.createElement('div');
	box.className = 'region-box';

	const title = document.createElement('h4');
	title.textContent = name;
	box.appendChild(title);

	const previewHolder = document.createElement('div');
	previewHolder.className = 'region-preview-holder';
	const canvas = ocr.getRegionCanvas(name);
	canvas.style.width = `${size.w * REGION_PREVIEW_SCALE}px`;
	canvas.style.height = `${size.h * REGION_PREVIEW_SCALE}px`;
	previewHolder.appendChild(canvas);
	box.appendChild(previewHolder);

	if (name === 'field') {
		const toggleLabel = document.createElement('label');
		const toggleInput = document.createElement('input');
		toggleInput.type = 'checkbox';
		toggleInput.checked = true;
		toggleLabel.appendChild(toggleInput);
		toggleLabel.appendChild(document.createTextNode(' Hide margin'));
		box.insertBefore(toggleLabel, previewHolder);

		applyFieldPreviewCrop(previewHolder, canvas, true);
		toggleInput.addEventListener('change', () => {
			applyFieldPreviewCrop(previewHolder, canvas, toggleInput.checked);
		});
	}

	const inputs = {};
	['x', 'y', 'w', 'h'].forEach(key => {
		const label = document.createElement('label');
		label.textContent = key.toUpperCase();
		const input = document.createElement('input');
		input.type = 'number';
		box.appendChild(label);
		box.appendChild(input);
		inputs[key] = input;
	});

	// Panel (digit/word) fields only -- see producer.js's own identical setup for the full
	// reasoning.
	if (PANEL_FIELD_NAMES.includes(name)) {
		const debugEl = document.createElement('div');
		debugEl.className = 'region-debug';
		box.appendChild(debugEl);
		regionDebugEls[name] = debugEl;
	}

	regionCalibrationContainer.appendChild(box);
	regionInputs[name] = inputs;

	Object.values(inputs).forEach(input => {
		input.addEventListener('input', () => {
			applyCalibration({
				...calibration,
				regions: {
					...(calibration?.regions ?? {}),
					[name]: {
						x: Number(inputs.x.value) || 0,
						y: Number(inputs.y.value) || 0,
						w: Number(inputs.w.value) || 1,
						h: Number(inputs.h.value) || 1,
					},
				},
			});
		});
	});
});

function updateRegionInputs() {
	Object.keys(CALIBRATION_REGIONS).forEach(name => {
		const rect = calibration?.regions?.[name];
		const inputs = regionInputs[name];
		inputs.x.value = rect ? Math.round(rect.x) : '';
		inputs.y.value = rect ? Math.round(rect.y) : '';
		inputs.w.value = rect ? Math.round(rect.w) : '';
		inputs.h.value = rect ? Math.round(rect.h) : '';
	});
}
updateRegionInputs();

function applyCalibration(next) {
	calibration = next;
	ocr.setCalibration(calibration);
	saveCalibration(calibration);
	updateCalInputs();
	updateRegionInputs();
}

// Editing the whole-screen fields directly only ever touches `screen` -- deliberately does NOT
// re-derive `regions`, unlike a fresh click-to-calibrate below, so it can't clobber per-region
// fine-tuning already done.
Object.values(calInputs).forEach(input => {
	input.addEventListener('input', () => {
		applyCalibration({
			...calibration,
			screen: {
				x: Number(calInputs.x.value) || 0,
				y: Number(calInputs.y.value) || 0,
				w: Number(calInputs.w.value) || 1,
				h: Number(calInputs.h.value) || 1,
			},
		});
	});
});

document.getElementById('cal-reset').addEventListener('click', () => {
	applyCalibration(null);
});

// Independent per-region calibration is single-player only for now (see constants.js's
// CALIBRATION_REGIONS comment) -- versus keeps calibrating just the whole screen, so showing 7
// region boxes that don't affect anything in that layout would only be confusing.
const regionFinetuneSection = document.getElementById(
	'region-finetune-section'
);

function updateSectionVisibility() {
	regionFinetuneSection.style.display =
		layoutSelect.value === LAYOUT.VERSUS ? 'none' : '';
}
updateSectionVisibility();

layoutSelect.addEventListener('change', () => {
	ocr.setConfig({ layout: layoutSelect.value, calibration });
	updateSectionVisibility();
	buildResultsSkeleton();
	buildTrackers();
});

let pendingCorner = null;

previewCanvas.addEventListener('click', event => {
	const rect = previewCanvas.getBoundingClientRect();
	const scaleX = previewCanvas.width / rect.width;
	const scaleY = previewCanvas.height / rect.height;
	const x = (event.clientX - rect.left) * scaleX;
	const y = (event.clientY - rect.top) * scaleY;

	if (!pendingCorner) {
		pendingCorner = { x, y };
		return;
	}

	const x0 = Math.min(pendingCorner.x, x);
	const y0 = Math.min(pendingCorner.y, y);
	const w = Math.abs(x - pendingCorner.x);
	const h = Math.abs(y - pendingCorner.y);
	pendingCorner = null;

	if (w > 4 && h > 4) {
		const screenRect = { x: x0, y: y0, w, h };
		applyCalibration({
			screen: screenRect,
			regions: deriveAllRegionsFromScreen(screenRect),
		});
	}
});

async function populateDevices() {
	const devices = await getConnectedDevices('videoinput');

	deviceSelect.innerHTML = '';
	devices.forEach(device => {
		const option = document.createElement('option');
		option.value = device.deviceId;
		option.textContent = device.label || device.deviceId;
		deviceSelect.appendChild(option);
	});
}
populateDevices();

document.getElementById('use-camera').addEventListener('click', async () => {
	await playVideoFromDevice(video, { device_id: deviceSelect.value });
});

document.getElementById('use-screen').addEventListener('click', async () => {
	await playVideoFromScreenCap(video);
});

video.addEventListener('loadedmetadata', () => {
	previewCanvas.width = video.videoWidth;
	previewCanvas.height = video.videoHeight;
});

function colorFor(cell) {
	if (!cell || cell.type === 'empty') return '#000';
	if (cell.type === 'unknown') return '#888';

	const rgb = COLOR_PALETTE[cell.color];
	return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : '#f0f';
}

// Viruses, pills, and clearing cells of the same color are otherwise indistinguishable at a
// glance in this small a swatch: viruses get a dark center dot, clearing cells get a hollow
// ring (echoing the actual hollow-ring sprite -- see templates.js CLEARING_TEMPLATE), pills
// stay a plain square.
function backgroundFor(cell) {
	const color = colorFor(cell);
	if (!cell) return color;

	if (cell.type === 'virus') {
		return `radial-gradient(circle at center, #000 22%, ${color} 23%)`;
	}

	if (cell.type === 'clearing') {
		return `radial-gradient(circle at center, #000 40%, ${color} 41%, ${color} 75%, #000 76%)`;
	}

	return color;
}

function renderBoard(container, board) {
	container.innerHTML = '';

	// null when the frame's bottle isn't on screen at all (pause/title/menu -- see
	// ScreenOCR.js's hasBottle) -- leave the grid blank rather than reading board[0].length.
	if (!board) return;

	container.className = 'board-grid';
	container.style.gridTemplateColumns = `repeat(${board[0].length}, 12px)`;

	board.flat().forEach(cell => {
		const div = document.createElement('div');
		div.className = 'board-cell';
		div.style.background = backgroundFor(cell);
		div.title = JSON.stringify(cell);
		container.appendChild(div);
	});
}

function renderNextPill(container, nextPill) {
	container.innerHTML = '';

	if (!nextPill) return;

	['left', 'right'].forEach(slot => {
		const span = document.createElement('span');
		span.className = 'next-pill-cell';
		span.style.background = colorFor(nextPill[slot]);
		container.appendChild(span);
	});
}

function buildResultsSkeleton() {
	if (layoutSelect.value === LAYOUT.VERSUS) {
		results.innerHTML = `
			<div class="players">
				<div>
					<h3>Player 1</h3>
					<p class="round-state" id="round-1p"></p>
					<div id="board-1p"></div>
					<p>Next: <span id="next-1p"></span></p>
					<p class="stats" id="stats-1p"></p>
				</div>
				<div>
					<h3>Player 2</h3>
					<p class="round-state" id="round-2p"></p>
					<div id="board-2p"></div>
					<p>Next: <span id="next-2p"></span></p>
					<p class="stats" id="stats-2p"></p>
				</div>
			</div>
			<p class="stats" id="crowns"></p>
		`;
	} else {
		results.innerHTML = `
			<p class="round-state" id="round-sp"></p>
			<div id="board-sp"></div>
			<p>Next: <span id="next-sp"></span></p>
			<p class="stats" id="stats-sp"></p>
		`;
	}
}
buildResultsSkeleton();

// 'playing' is the ordinary state and not worth calling out; the others are. null means no
// bottle on screen at all (pause/title/menu -- see ScreenOCR.js's hasBottle).
function renderRoundState(element, state) {
	if (state === 'playing') {
		element.textContent = '';
	} else if (state === null) {
		element.textContent = 'NO BOTTLE (PAUSED/MENU)';
	} else {
		element.textContent = state.replace('_', ' ').toUpperCase();
	}
}

function renderResult(result) {
	if (result.layout === LAYOUT.VERSUS) {
		renderRoundState(
			document.getElementById('round-1p'),
			result.player1.result
		);
		renderRoundState(
			document.getElementById('round-2p'),
			result.player2.result
		);
		renderBoard(document.getElementById('board-1p'), result.player1.board);
		renderBoard(document.getElementById('board-2p'), result.player2.board);
		renderNextPill(document.getElementById('next-1p'), result.player1.nextPill);
		renderNextPill(document.getElementById('next-2p'), result.player2.nextPill);

		document.getElementById('stats-1p').textContent =
			`Level ${result.player1.level ?? '?'} / Speed ${result.player1.speed ?? '?'} / Virus ${result.player1.virus ?? '?'}`;
		document.getElementById('stats-2p').textContent =
			`Level ${result.player2.level ?? '?'} / Speed ${result.player2.speed ?? '?'} / Virus ${result.player2.virus ?? '?'}`;
		document.getElementById('crowns').textContent =
			`Crowns -- P1: ${result.crowns.player1.wins} / P2: ${result.crowns.player2.wins}`;

		trackers.player1.processFrame(result.player1);
		trackers.player2.processFrame(result.player2);
	} else {
		renderRoundState(document.getElementById('round-sp'), result.result);
		renderBoard(document.getElementById('board-sp'), result.board);
		renderNextPill(document.getElementById('next-sp'), result.nextPill);

		document.getElementById('stats-sp').textContent =
			`Top ${result.top ?? '?'} / Score ${result.score ?? '?'} / Level ${result.level ?? '?'} / Speed ${result.speed ?? '?'} / Virus ${result.virus ?? '?'}`;

		trackers.single.processFrame(result);
	}
}

// Panel-field diagnostics -- see producer.js's own identical setup for the full reasoning.
function formatFieldDebug(name, debug) {
	if (!debug) return '';

	const formatEntry = ({ value, distance, bestGuess }) =>
		value !== null
			? `${value} (d=${distance})`
			: `<span class="miss">? guess=${bestGuess ?? '-'} d=${distance ?? '-'}</span>`;

	return name === 'speed'
		? formatEntry(debug)
		: debug.map(formatEntry).join('  ');
}

function updatePanelDebug() {
	const panelDebug = ocr.getLastPanelDebug();

	PANEL_FIELD_NAMES.forEach(name => {
		regionDebugEls[name].innerHTML = formatFieldDebug(name, panelDebug?.[name]);
	});
}

function loop() {
	requestAnimationFrame(loop);

	if (video.readyState < 2) return; // HAVE_CURRENT_DATA -- nothing decoded yet

	previewCtx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);

	if (!calibration?.screen) return;

	previewCtx.strokeStyle = '#0f0';
	previewCtx.lineWidth = 2;
	previewCtx.strokeRect(
		calibration.screen.x,
		calibration.screen.y,
		calibration.screen.w,
		calibration.screen.h
	);

	const result = ocr.processVideoFrame({ video });
	if (layoutSelect.value !== LAYOUT.VERSUS) updatePanelDebug();
	if (result) renderResult(result);
}
requestAnimationFrame(loop);
