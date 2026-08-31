import UserDAO from '../daos/UserDAO.js';
import Room from './Room.js';

const VALID_BESTOF = [3, 5];

// Dr Mario "Speed" mode: two players each play their own independent single-player game, racing
// to clear a configured set of consecutive levels. Unlike Tetris's MatchRoom (which this is *not*
// a clone of -- no WebRTC camera peer relay, no curtain logos, no camera mirroring, no flexible
// N-player reassignment), this is a small, fixed 2-slot room whose only real job is: relay two
// independently-connected players' existing, completely unmodified producer frames to a view,
// tagged by slot, and hold authoritative best-of-N match state (bestof/levelSet/victories/
// raceNumber) that survives a view reload.
//
// Key design point: a Dr Mario producer connection only ever emits JSON frames -- nothing
// server-side tracks game/score state the way Tetris's Game/Producer does. So attaching a player
// to a slot doesn't require *that player's own connection* to "join" anything via a special URL
// (unlike Tetris's u/<login>/producer1 convention) -- the admin instead tells the room "player 1
// = this secret," the room resolves it via the same UserDAO.getUserBySecret() lookup the view
// path already uses, and subscribes to that user's existing producer connection going forward
// (see User.js's drmario_speed_attachment / _handleDrMarioProducerMessage). Players never see
// anything new: they keep using producer.html exactly as it already works.
//
// Race-winner detection is deliberately manual (recordRaceResult, admin-driven), never inferred
// from game state -- the server only ever relays frames here, same as everywhere else in this
// codebase, and the losing player may never finish their own run at all.
class DrMarioSpeedRoom extends Room {
	constructor(owner) {
		super(owner);

		this.admin = null;
		this.bestof = VALID_BESTOF[0];
		this.levelSet = [];
		this.raceNumber = 1;
		this.headerText = ''; // free text, admin-set -- replaces the view's own "BEST OF X --
		// RACE Y" computed default (see drmario_speed.html)
		this.victories = [0, 0];
		this.players = [{ user: null }, { user: null }];
		this._playerCloseListeners = [null, null];

		this.handleAdminMessage = this.handleAdminMessage.bind(this);
	}

	setAdmin(connection) {
		// Only the room owner may administer it.
		if (connection.user.id != this.owner.id) {
			connection.kick('forbidden');
			return;
		}

		if (this.admin) {
			this.admin.kick('concurrency_limit');
		}
		this.admin = connection;

		connection.on('message', this.handleAdminMessage);
		connection.once('close', () => {
			if (this.admin === connection) {
				this.admin = null;
			}
		});

		this.sendStateToAdmin();
	}

	assertValidSlot(slot) {
		if (slot !== 0 && slot !== 1) {
			throw new RangeError(`DrMarioSpeedRoom: invalid player slot (${slot})`);
		}
	}

	#detachSlot(slot) {
		const existing = this.players[slot].user;

		if (existing) {
			if (existing.drmario_speed_attachment?.room === this) {
				existing.drmario_speed_attachment = null;
			}

			const listener = this._playerCloseListeners[slot];
			if (listener) {
				existing.getDrMarioProducer().off('close', listener);
			}
		}

		this.players[slot].user = null;
		this._playerCloseListeners[slot] = null;
	}

	async setPlayer(slot, secret) {
		this.assertValidSlot(slot);

		const user = await UserDAO.getUserBySecret(secret);
		if (!user) return;

		this.#detachSlot(slot);

		this.players[slot].user = user;
		user.drmario_speed_attachment = { room: this, slot };

		// Kept live (not just a one-off dump) so the admin sees a dropped feed without having to
		// take any action themselves.
		const onProducerClose = () => this.sendStateToAdmin();
		this._playerCloseListeners[slot] = onProducerClose;
		user.getDrMarioProducer().on('close', onProducerClose);
	}

	setBestOf(n) {
		const value = parseInt(n, 10);
		if (!VALID_BESTOF.includes(value)) return;

		this.bestof = value;
		this.sendToViews(['setBestOf', this.bestof]);
	}

	setLevelSet(levels) {
		if (!Array.isArray(levels) || levels.length === 0) return;

		this.levelSet = levels.map(level => parseInt(level, 10));
		this.sendToViews(['setLevelSet', [...this.levelSet]]);
	}

	setHeaderText(text) {
		this.headerText = `${text ?? ''}`;
		this.sendToViews(['setHeaderText', this.headerText]);
	}

	// Manual -- the admin watches the stream and calls it, since a losing player may never
	// finish their own run and the server never interprets frames to detect this itself.
	recordRaceResult(winnerSlot) {
		this.assertValidSlot(winnerSlot);

		this.victories[winnerSlot]++;
		this.raceNumber++;

		this.sendToViews(['setVictories', [...this.victories]]);
		this.sendToViews(['setRaceNumber', this.raceNumber]);
		this.sendToViews(['resetRace']); // both players' trackers reset for the next race
	}

	// Resets just one player's current run, for aborting a bad/invalid attempt without ending
	// the race -- distinct from recordRaceResult, which ends the race for both players.
	resetPlayerRun(slot) {
		this.assertValidSlot(slot);

		this.sendToViews(['resetPlayerRun', slot]);
	}

	resetMatch() {
		this.victories = [0, 0];
		this.raceNumber = 1;

		this.sendToViews(['setVictories', [...this.victories]]);
		this.sendToViews(['setRaceNumber', this.raceNumber]);
		this.sendToViews(['resetRace']);
	}

	async handleAdminMessage(message) {
		const [command, ...args] = message;

		try {
			switch (command) {
				case 'getState': {
					break;
				}

				case 'setPlayer': {
					await this.setPlayer(...args);
					break;
				}

				case 'setBestOf': {
					this.setBestOf(...args);
					break;
				}

				case 'setLevelSet': {
					this.setLevelSet(...args);
					break;
				}

				case 'setHeaderText': {
					this.setHeaderText(...args);
					break;
				}

				case 'recordRaceResult': {
					this.recordRaceResult(...args);
					break;
				}

				case 'resetPlayerRun': {
					this.resetPlayerRun(...args);
					break;
				}

				case 'resetMatch': {
					this.resetMatch();
					break;
				}

				default: {
					console.warn(`DrMarioSpeedRoom: received unknown command ${command}`);
					return;
				}
			}

			this.sendStateToAdmin();
		} catch (err) {
			console.error(err);
		}
	}

	// Parameterized version of Room's own generic fallback (['frame', slot, message] instead of
	// hardcoded 0) -- the same "tag with an index" convention Tetris's MatchRoom.
	// handleProducerMessage and the base Room fallback both already use. Dr Mario producers only
	// ever emit JSON, never binary frames (see DrMarioProducer.js), so unlike the base Room class
	// there's no Uint8Array branch to handle here.
	handleProducerMessage(slot, user, message) {
		if (Array.isArray(message)) {
			this.sendToViews([message[0], slot, ...message.slice(1)]);
		} else {
			this.sendGameFrameToViews(['frame', slot, message]);
		}
	}

	addView(connection) {
		super.addView(connection);

		// State dump for the newly-connected view, mirroring MatchRoom.addView()'s own precedent.
		connection.send(['setBestOf', this.bestof]);
		connection.send(['setLevelSet', [...this.levelSet]]);
		connection.send(['setVictories', [...this.victories]]);
		connection.send(['setRaceNumber', this.raceNumber]);
		connection.send(['setHeaderText', this.headerText]);
	}

	getState() {
		return {
			bestof: this.bestof,
			levelSet: [...this.levelSet],
			raceNumber: this.raceNumber,
			headerText: this.headerText,
			victories: [...this.victories],
			players: this.players.map(({ user }) =>
				user
					? {
							id: user.id,
							login: user.login,
							connected: user.getDrMarioProducer().hasConnection(),
						}
					: { id: null, login: null, connected: false }
			),
		};
	}

	sendStateToAdmin() {
		if (!this.admin) return;

		this.admin.send(['state', this.getState()]);
	}

	close(reason) {
		super.close(reason);

		[0, 1].forEach(slot => this.#detachSlot(slot));

		if (this.admin) {
			this.admin.kick(reason);
			this.admin = null;
		}
	}
}

export default DrMarioSpeedRoom;
