const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    difficulty: { type: String, required: true, index: true },
    rows: Number,
    cols: Number,
    timeLimit: Number,
    // Secret layout: symbol id per card position. Never sent to the client until a card is flipped.
    cards: { type: [Number], select: false },
    matched: { type: [Boolean], default: [] },
    pending: { type: Number, default: null }, // index of first card of the current pair
    status: { type: String, enum: ['active', 'won', 'lost', 'abandoned'], default: 'active', index: true },
    moves: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    pairsFound: { type: Number, default: 0 },
    totalPairs: Number,
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
    durationMs: Number,
    reward: { type: Number, default: 0 },
    rules: { type: Object, select: false }, // snapshot of difficulty rules at game start
  },
  { timestamps: true }
);

const Game = mongoose.model('Game', gameSchema);

module.exports = { Game };
