// Wiring for producer.html: video source selection, click-to-calibrate, live rendering of
// whatever DrMarioOCR decodes each frame (for the operator to confirm capture is correct), and
// streaming each frame to the server over a Connection for broadcast. Both single-player and
// versus layouts -- see CLAUDE.md for what's still not wired up (networked/match-room
// single-player). Adapted from harness.js; that file stays a pure OCR-testing tool with no
// network connection, this one is the real capture pipeline.

import { LAYOUT, REFERENCE_SIZE, COLOR_PALETTE } from './constants.js';
import { DrMarioOCR } from './DrMarioOCR.js';
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
	try {
		return raw ? JSON.parse(raw) : null;
	} catch (_err) {
		return null;
	}
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
		trackers = { single: new RoundTracker() };
		wireTracker(trackers.single, 'SP');
	}
}

function updateCalInputs() {
	calInputs.x.value = calibration ? Math.round(calibration.x) : '';
	calInputs.y.value = calibration ? Math.round(calibration.y) : '';
	calInputs.w.value = calibration ? Math.round(calibration.w) : '';
	calInputs.h.value = calibration ? Math.round(calibration.h) : '';
}
updateCalInputs();

function applyCalibration(next) {
	calibration = next;
	ocr.setCalibration(calibration);
	saveToStorage(CAL_STORAGE_KEY, JSON.stringify(calibration));
	updateCalInputs();
}

Object.values(calInputs).forEach(input => {
	input.addEventListener('input', () => {
		applyCalibration({
			x: Number(calInputs.x.value) || 0,
			y: Number(calInputs.y.value) || 0,
			w: Number(calInputs.w.value) || 1,
			h: Number(calInputs.h.value) || 1,
		});
	});
});

document.getElementById('cal-reset').addEventListener('click', () => {
	calibration = null;
	ocr.setCalibration(null);
	saveToStorage(CAL_STORAGE_KEY, null);
	updateCalInputs();
});

layoutSelect.addEventListener('change', () => {
	saveToStorage(LAYOUT_STORAGE_KEY, layoutSelect.value);
	ocr.setConfig({ layout: layoutSelect.value, calibration });
	buildResultsSkeleton();
	buildTrackers();
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
		applyCalibration({ x: x0, y: y0, w, h });
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

function loop() {
	requestAnimationFrame(loop);

	if (video.readyState < 2) return; // HAVE_CURRENT_DATA -- nothing decoded yet

	previewCtx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);

	if (!calibration) return;

	previewCtx.strokeStyle = '#0f0';
	previewCtx.lineWidth = 2;
	previewCtx.strokeRect(
		calibration.x,
		calibration.y,
		calibration.w,
		calibration.h
	);

	const result = ocr.processVideoFrame({ video });
	if (!result) return;

	if (result.layout === LAYOUT.VERSUS) {
		result.playerNames = {
			player1: player1NameInput.value.trim() || 'Player 1',
			player2: player2NameInput.value.trim() || 'Player 2',
		};
		result.eventName = eventNameInput.value.trim();
		result.roundName = roundNameInput.value.trim();
	}

	renderResult(result);

	if (producerConnection) {
		producerConnection.send(result);
	}
}
requestAnimationFrame(loop);
