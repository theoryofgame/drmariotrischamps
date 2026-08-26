import EventEmitter from 'events';

// Mirrors Producer.js's connection lifecycle, but without any of the Tetris-specific Game
// tracking -- this phase only relays frames to views, it doesn't interpret them server-side.
// See Room.js's handleProducerMessage(): a plain (non-Uint8Array, non-Array) message -- i.e. a
// Dr Mario frame, sent as JSON rather than Tetris's packed binary format -- already gets wrapped
// and broadcast to views by that existing, unmodified code path.
class DrMarioProducer extends EventEmitter {
	constructor(user) {
		super();

		this.user = user;
		this.connection = null;

		this._handleMessage = this._handleMessage.bind(this);
	}

	setConnection(connection) {
		this.kick('concurrency_limit');

		connection.on('message', this._handleMessage);

		connection.once('close', () => {
			this.connection.removeAllListeners();

			if (this.connection === connection) {
				this.connection = null;
				this.emit('close');
			}
		});

		connection.once('error', err => {
			this.emit('error', err);
		});

		this.connection = connection;
	}

	hasConnection() {
		return !!this.connection;
	}

	kick(reason) {
		if (this.connection) {
			this.connection.kick(reason);
		}
	}

	getPeerId() {
		if (this.connection) {
			return this.connection.id;
		}
		return '';
	}

	send(message) {
		if (this.connection) {
			this.connection.send(message);
		}
	}

	_handleMessage(message) {
		this.emit('message', message);
	}
}

export default DrMarioProducer;
