const mongoose = require('mongoose');

const difficultySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    rows: { type: Number, required: true, min: 2, max: 8 },
    cols: { type: Number, required: true, min: 2, max: 8 },
    timeLimit: { type: Number, required: true, min: 10, max: 3600 }, // seconds
    matchPoints: { type: Number, required: true, min: 0, max: 10000 },
    mismatchPenalty: { type: Number, required: true, min: 0, max: 10000 },
    streakBonus: { type: Number, required: true, min: 0, max: 10000 },
    timeBonusPerSecond: { type: Number, required: true, min: 0, max: 1000 },
    winReward: { type: Number, required: true, min: 0, max: 100000 }, // coins
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Difficulty = mongoose.model('Difficulty', difficultySchema);

const DEFAULT_DIFFICULTIES = [
  { key: 'easy', name: 'Easy', rows: 3, cols: 4, timeLimit: 90, matchPoints: 100, mismatchPenalty: 5, streakBonus: 20, timeBonusPerSecond: 2, winReward: 10, order: 1 },
  { key: 'medium', name: 'Medium', rows: 4, cols: 4, timeLimit: 120, matchPoints: 150, mismatchPenalty: 10, streakBonus: 30, timeBonusPerSecond: 3, winReward: 25, order: 2 },
  { key: 'hard', name: 'Hard', rows: 5, cols: 6, timeLimit: 180, matchPoints: 200, mismatchPenalty: 15, streakBonus: 50, timeBonusPerSecond: 5, winReward: 60, order: 3 },
];

module.exports = { Difficulty, DEFAULT_DIFFICULTIES };
