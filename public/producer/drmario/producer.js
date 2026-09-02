// Wiring for producer.html: video source selection, click-to-calibrate, live rendering of
// whatever DrMarioOCR decodes each frame (for the operator to confirm capture is correct), and
// streaming each frame to the server over a Connection for broadcast. Both single-player and
// versus layouts -- see CLAUDE.md for what's still not wired up (networked/match-room
// single-player). Adapted from harness.js; that file stays a pure OCR-testing tool with no
// network connection, this one is the real capture pipeline.

import {
	LAYOUT,
	REFERENCE_SIZE,
	COLOR_PALETTE,
	CALIBRATION_REGIONS,
} from './constants.js';
import { DrMarioOCR } from './DrMarioOCR.js';
import {
	deriveAllRegionsFromScreen,
	calibrationFromBottleRect,
	bottleRectFromCalibration,
} from './calibrationMath.js';
import RoundTracker from './RoundTracker.js';
import Connection from '/js/connection.js';
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

const CAL_STORAGE_KEY = 'drmario_producer_calibration';
const SECRET_STORAGE_KEY = 'drmario_producer_secret';
const LAYOUT_STORAGE_KEY = 'drmario_producer_layout';
const PLAYER1_NAME_STORAGE_KEY = 'drmario_producer_player1_name';
const PLAYER2_NAME_STORAGE_KEY = 'drmario_producer_player2_name';
const EVENT_NAME_STORAGE_KEY = 'drmario_producer_event_name';
const ROUND_NAME_STORAGE_KEY = 'drmario_producer_round_name';
const SINGLE_PLAYER_NAME_STORAGE_KEY = 'drmario_producer_single_player_name';

function loadFromStorage(key) {
	try {
		return localStorage.getItem(key);
	} catch (_err) {
		return null;
	}
}

function saveToStorage(key, value) {
	try {
		if (value === null) {
			localStorage.removeItem(key);
		} else {
			localStorage.setItem(key, value);
		}
	} catch (_err) {
		// ignore -- just won't persist across reloads
	}
}

function loadCalibration() {
	const raw = loadFromStorage(CAL_STORAGE_KEY);
	if (!raw) return null;

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (_err) {
		return null;
	}
	if (!parsed) return null;

	// Old shape (before independent per-region calibration existed): a flat {x,y,w,h} whole-
	// screen rect. Migrate it forward -- treat it as `screen`, and derive a starting value for
	// every region from it via the exact same quick-seed math a fresh click would use, so an
	// operator who already calibrated doesn't have to start completely over.
	if (!parsed.regions) {
		return { screen: parsed, regions: deriveAllRegionsFromScreen(parsed) };
	}

	return parsed;
}

let calibration = loadCalibration();

// Unlike harness.js (a pure testing tool, where defaulting to whatever <option> happens to come
// first in the markup is harmless), this page's layout choice controls what actually gets
// broadcast -- silently defaulting to single-player on every reload previously sent
// single-player-shaped frames to a versus view expecting `layout: 'versus'`, which just ignores
// them, making the broadcast look dead. Persisted the same way calibration/secret already are,
// defaulting to versus (this page's original hardcoded-only mode) when nothing's been saved yet.
layoutSelect.value = loadFromStorage(LAYOUT_STORAGE_KEY) || LAYOUT.VERSUS;

const ocr = new DrMarioOCR({ layout: layoutSelect.value, calibration });

const referenceCanvas = ocr.getReferenceCanvas();
referenceCanvas.style.width = `${REFERENCE_SIZE.w * 2}px`;
referenceCanvas.style.height = `${REFERENCE_SIZE.h * 2}px`;
referenceHolder.appendChild(referenceCanvas);

// RoundTracker instance(s), rebuilt (not just reset) on layout change since a player-1-vs-
// player-2 pair only makes sense once you're actually in versus mode -- same as harness.js. This
// is only for the operator's own event log while setting up; the view re-derives the same state
// itself from the same frame stream, it isn't sent over the wire.
const eventLog = document.getElementById('event-log');
const MAX_LOG_LINES = 100;
let trackers = {};

function formatDetailValue(key, value) {
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

		// Versus mode's round boundary is shared -- see RoundTracker.js's header comment for why
		// both endRound() and syncRoundStart() are needed, not just one. Same wiring as
		// drmario_versus.html's view.
		trackers.player1.addEventListener('round_end', event =>
			trackers.player2.endRound(`opponent_${event.detail.outcome}`)
		);
		trackers.player2.addEventListener('round_end', event =>
			trackers.player1.endRound(`opponent_${event.detail.outcome}`)
		);
		trackers.player1.addEventListener('round_start', event =>
			trackers.player2.syncRoundStart({ roundId: event.detail.roundId })
		);
		trackers.player2.addEventListener('round_start', event =>
			trackers.player1.syncRoundStart({ roundId: event.detail.roundId })
		);
	} else {
		// useNextPillBlankDetection: single-player only -- see RoundTracker.js's header comment
		// for why versus can't use this strategy.
		trackers = {
			single: new RoundTracker({ useNextPillBlankDetection: true }),
		};
		wireTracker(trackers.single, 'SP');
	}
}

function updateCalInputs() {
	const screen = calibration?.screen;
	calInputs.x.value = screen ? Math.round(screen.x) : '';
	calInputs.y.value = screen ? Math.round(screen.y) : '';
	calInputs.w.value = screen ? Math.round(screen.w) : '';
	calInputs.h.value = screen ? Math.round(screen.h) : '';
}
updateCalInputs();

// One small box per CALIBRATION_REGIONS entry: its own live preview (the region's own persistent
// canvas from DrMarioOCR -- appending it directly means it just keeps redrawing itself every
// frame with no extra render code needed here, the same trick already used for the whole-screen
// reference canvas above) plus its own X/Y/W/H inputs. Built once; only the inputs' values and
// the canvases' own pixel content change afterward.
const regionCalibrationContainer =
	document.getElementById('region-calibration');
const REGION_PREVIEW_SCALE = 3;
const regionInputs = {};
const PANEL_FIELD_NAMES = ['top', 'score', 'level', 'virus', 'speed'];
const regionDebugEls = {};

// field is the only region with a margin at all (see constants.js's own comment on
// CALIBRATION_REGIONS -- FIELD_MARGIN exists purely for ScreenOCR.hasBottle()'s wall-check
// points). Showing that margin by default makes the one thing this box is actually for --
// judging whether the *interior* is aligned -- harder to eyeball, per direct feedback, so this
// crops the display down to just CALIBRATION_REGIONS.field.local by default (a CSS-only crop;
// the captured canvas itself, and everything BoardOCR/ScreenOCR/ResultOCR read from it, is
// completely unaffected either way), with a checkbox to reveal the full margin-inclusive capture
// when actually checking the wall-check area specifically.
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

	// Panel (digit/word) fields only -- shows *why* a field isn't reading (which digit, how
	// close the nearest template actually was) instead of just that it isn't, using
	// DrMarioOCR's own getLastPanelDebug() (see loop()) -- requested directly after a live
	// session where speed/virus wouldn't read and there was no way to see more than "it failed."
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
	saveToStorage(CAL_STORAGE_KEY, JSON.stringify(calibration));
	updateCalInputs();
	updateRegionInputs();
}

// Editing the whole-screen fields directly only ever touches `screen` (affects isTitleScreen()
// and the green preview box) -- deliberately does NOT re-derive `regions`, unlike a fresh
// click-to-calibrate (see below), so it can't clobber per-region fine-tuning the operator has
// already done.
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

// versus-only fields (player names, event/round name) and the single-player-only name field are
// mutually exclusive -- shown/hidden based on the selected layout so a solo streamer (Speed
// racers included) never sees fields that don't apply to them.
const singlePlayerNameSection = document.getElementById(
	'single-player-name-section'
);
const playerNamesSection = document.getElementById('player-names-section');
const eventInfoSection = document.getElementById('event-info-section');
// Independent per-region calibration is single-player only for now (see constants.js's
// CALIBRATION_REGIONS comment) -- versus keeps calibrating just the whole screen, so showing 7
// region boxes that don't affect anything in that layout would only be confusing.
const regionFinetuneSection = document.getElementById(
	'region-finetune-section'
);

function updateSectionVisibility() {
	const isVersus = layoutSelect.value === LAYOUT.VERSUS;
	singlePlayerNameSection.style.display = isVersus ? 'none' : '';
	playerNamesSection.style.display = isVersus ? '' : 'none';
	eventInfoSection.style.display = isVersus ? '' : 'none';
	regionFinetuneSection.style.display = isVersus ? 'none' : '';
}
updateSectionVisibility();

layoutSelect.addEventListener('change', () => {
	saveToStorage(LAYOUT_STORAGE_KEY, layoutSelect.value);
	ocr.setConfig({ layout: layoutSelect.value, calibration });
	updateSectionVisibility();
	buildResultsSkeleton();
	buildTrackers();
});

// Single-player name -- attached to every outgoing single-player frame (see loop()), same
// "attach to every frame, not a one-off message" pattern as the versus-only fields below, so a
// view connecting mid-session still picks up the current value on the very next frame. This is
// what lets a Speed admin skip typing player names entirely (see drmario_speed.html).
const singlePlayerNameInput = document.getElementById('single-player-name');
singlePlayerNameInput.value =
	loadFromStorage(SINGLE_PLAYER_NAME_STORAGE_KEY) || '';
singlePlayerNameInput.addEventListener('input', () => {
	saveToStorage(SINGLE_PLAYER_NAME_STORAGE_KEY, singlePlayerNameInput.value);
});

// Player names (versus only) -- attached to every outgoing versus frame (see loop()) rather than
// sent as a one-off message, so a view that connects after the operator has already set them
// still picks them up on the very next frame instead of being stuck with the defaults until the
// operator happens to retype something.
const player1NameInput = document.getElementById('player1-name');
const player2NameInput = document.getElementById('player2-name');
player1NameInput.value = loadFromStorage(PLAYER1_NAME_STORAGE_KEY) || '';
player2NameInput.value = loadFromStorage(PLAYER2_NAME_STORAGE_KEY) || '';
player1NameInput.addEventListener('input', () => {
	saveToStorage(PLAYER1_NAME_STORAGE_KEY, player1NameInput.value);
});
player2NameInput.addEventListener('input', () => {
	saveToStorage(PLAYER2_NAME_STORAGE_KEY, player2NameInput.value);
});

// Event/round name (versus only) -- same reasoning and wiring as player names above: attached to
// every outgoing versus frame rather than sent as a one-off message, so a view connecting mid-
// session still picks up the current values on the very next frame.
const eventNameInput = document.getElementById('event-name');
const roundNameInput = document.getElementById('round-name');
eventNameInput.value = loadFromStorage(EVENT_NAME_STORAGE_KEY) || '';
roundNameInput.value = loadFromStorage(ROUND_NAME_STORAGE_KEY) || '';
eventNameInput.addEventListener('input', () => {
	saveToStorage(EVENT_NAME_STORAGE_KEY, eventNameInput.value);
});
roundNameInput.addEventListener('input', () => {
	saveToStorage(ROUND_NAME_STORAGE_KEY, roundNameInput.value);
});

// Calibration target: clicking the whole screen's own corners means fighting the decorative
// checkerboard background's edges, which -- confirmed directly against a real relayed/Twitch
// capture -- is exactly the kind of fine repeating detail video compression smears first, making
// it genuinely hard to click precisely. The bottle interior (the solid black playfield, bounded
// by bright solid-cyan walls) is a much sharper, higher-contrast landmark, and its exact position
// within the 256x224 reference frame is already known (constants.js's FIELD, or VERSUS.BOTTLE_1P
// -- same width/height, only the x origin differs -- depending on the selected layout), so the
// whole-screen calibration rect can be extrapolated from it instead of clicked directly.
const CALIBRATION_HINTS = {
	bottle:
		"Click the top-left corner of the bottle's black playfield (just inside the cyan walls) in the preview below, then the bottom-right corner. The rest of the screen is extrapolated from that. Fine-tune with the fields if needed. Saved automatically.",
	screen:
		'Click the top-left corner of the NES screen in the preview below, then click the bottom-right corner. Fine-tune with the fields if needed. Saved automatically.',
};
const calibrationHintEl = document.getElementById('calibration-hint');

const CALIBRATION_TARGET_STORAGE_KEY = 'drmario_producer_calibration_target';
const calibrationTargetSelect = document.getElementById('calibration-target');
calibrationTargetSelect.value =
	loadFromStorage(CALIBRATION_TARGET_STORAGE_KEY) || 'bottle';

function updateCalibrationHint() {
	calibrationHintEl.textContent =
		CALIBRATION_HINTS[calibrationTargetSelect.value];
}
updateCalibrationHint();

calibrationTargetSelect.addEventListener('change', () => {
	saveToStorage(CALIBRATION_TARGET_STORAGE_KEY, calibrationTargetSelect.value);
	updateCalibrationHint();
	pendingCorner = null; // discard an in-progress first click if the target changes mid-click
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

	if (w <= 4 || h <= 4) return;

	const clickedRect = { x: x0, y: y0, w, h };
	const screenRect =
		calibrationTargetSelect.value === 'bottle'
			? calibrationFromBottleRect(clickedRect, layoutSelect.value)
			: clickedRect;

	// A click here is always a full "quick seed" -- unlike editing the whole-screen fields
	// directly, it re-derives every region from scratch, on the assumption the operator is
	// (re)starting calibration from this landmark rather than nudging one already-tuned value.
	applyCalibration({
		screen: screenRect,
		regions: deriveAllRegionsFromScreen(screenRect),
	});
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

// --- Broadcast connection -----------------------------------------------------------------

const secretInput = document.getElementById('secret');
const statusEl = document.getElementById('broadcast-status');
secretInput.value = loadFromStorage(SECRET_STORAGE_KEY) || '';

let producerConnection = null;

function setStatus(text, connected) {
	statusEl.textContent = text;
	statusEl.className = connected ? 'connected' : 'disconnected';
}

document.getElementById('connect').addEventListener('click', () => {
	const secret = secretInput.value.trim();
	if (!secret) return;

	saveToStorage(SECRET_STORAGE_KEY, secret);

	if (producerConnection) {
		producerConnection.close();
	}

	const wsProtocol = location.protocol.match(/^https/i) ? 'wss:' : 'ws:';
	const url = `${wsProtocol}//${location.host}/ws/room/drmario/producer/${secret}`;

	producerConnection = new Connection(url);
	producerConnection.onOpen = () => setStatus('Connected', true);
	producerConnection.onBreak = () =>
		setStatus('Connection lost, retrying...', false);
	producerConnection.onResume = () => setStatus('Connected', true);
	producerConnection.onKicked = reason => setStatus(`Kicked: ${reason}`, false);

	setStatus('Connecting...', false);
});

document.getElementById('disconnect').addEventListener('click', () => {
	if (producerConnection) {
		producerConnection.close();
		producerConnection = null;
	}
	setStatus('Disconnected', false);
});

// --- Rendering (for the operator) ----------------------------------------------------------

function colorFor(cell) {
	if (!cell || cell.type === 'empty') return '#000';
	if (cell.type === 'unknown') return '#888';

	const rgb = COLOR_PALETTE[cell.color];
	return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : '#f0f';
}

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
buildTrackers();

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

// Panel-field diagnostics -- see DrMarioOCR.getLastPanelDebug()'s own comment. A digit field's
// debug is an array (one entry per digit slot); speed's is a single { value, distance,
// bestGuess } since it matches the whole word as one shape rather than per-character.
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

	// Direct visual check for the quick seed (see calibrationFromBottleRect()/
	// deriveAllRegionsFromScreen()): the green box above is always the whole-screen rect, which
	// doesn't by itself confirm a bottle click landed precisely against the cyan walls -- this
	// box shows where the bottle interior is *expected* to be from that whole-screen value alone,
	// so it should hug the walls snugly right after a quick seed. It intentionally doesn't reflect
	// any independent fine-tuning of the field region afterward (see step 2's own live preview for
	// that -- this one's only job is sanity-checking the quick seed itself).
	const bottleRect = bottleRectFromCalibration(
		calibration.screen,
		layoutSelect.value
	);
	previewCtx.strokeStyle = '#ff0';
	previewCtx.strokeRect(bottleRect.x, bottleRect.y, bottleRect.w, bottleRect.h);

	const result = ocr.processVideoFrame({ video });
	if (layoutSelect.value !== LAYOUT.VERSUS) updatePanelDebug();
	if (!result) return;

	if (result.layout === LAYOUT.VERSUS) {
		result.playerNames = {
			player1: player1NameInput.value.trim() || 'Player 1',
			player2: player2NameInput.value.trim() || 'Player 2',
		};
		result.eventName = eventNameInput.value.trim();
		result.roundName = roundNameInput.value.trim();
	} else {
		// Not sent as a one-off message so a view connecting mid-session (e.g. a Speed admin
		// attaching this producer to a race slot after broadcast has already started) still picks
		// up the current value on the very next frame.
		result.playerName = singlePlayerNameInput.value.trim();
	}

	renderResult(result);

	if (producerConnection) {
		producerConnection.send(result);
	}
}
requestAnimationFrame(loop);
