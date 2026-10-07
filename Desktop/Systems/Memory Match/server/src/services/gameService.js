const crypto = require('node:crypto');
const { Game } = require('../models/Game.js');
const { User } = require('../models/User.js');
const { Difficulty } = require('../models/Difficulty.js');
const { HttpError } = require('../middleware/validate.js');

const GRACE_MS = 1500; // network slack when enforcing the time limit
const SYMBOL_COUNT = 40; // the client ships at least this many symbols

// Per-game mutex so two simultaneous flips can never interleave (double-click / scripted spam).
const locks = new Set();
async function withLock(id, fn) {
  const key = String(id);
  if (locks.has(key)) throw new HttpError(429, 'Previous move still processing');
  locks.add(key);
  try {
    return await fn();
  } finally {
    locks.delete(key);
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffledDeck(pairs) {
  const symbols = shuffle(Array.from({ length: SYMBOL_COUNT }, (_, i) => i));
  return shuffle(symbols.slice(0, pairs).flatMap((s) => [s, s]));
}

function publicView(game) {
  const active = game.status === 'active';
  const elapsed = (game.endedAt ? game.endedAt.getTime() : Date.now()) - game.startedAt.getTime();
  const revealed = {};
  if (game.cards?.length) {
    game.matched.forEach((m, i) => {
      if (m) revealed[i] = game.cards[i];
    });
    // Once the game has ended there is nothing left to hide
    if (!active) game.cards.forEach((s, i) => (revealed[i] = s));
  }
  return {
    id: game._id,
    difficulty: game.difficulty,
    rows: game.rows,
    cols: game.cols,
    timeLimit: game.timeLimit,
    status: game.status,
    moves: game.moves,
    score: game.score,
    streak: game.streak,
    pairsFound: game.pairsFound,
    totalPairs: game.totalPairs,
    elapsedMs: Math.min(elapsed, game.timeLimit * 1000),
    matched: game.matched,
    revealed, // index -> symbol; only matched cards while playing, everything after the game
    pending:
      game.pending !== null && game.cards?.length ? { index: game.pending, symbol: game.cards[game.pending] } : null,
    reward: game.reward,
    durationMs: game.durationMs,
  };
}

async function finish(game, status) {
  const limitMs = game.timeLimit * 1000;
  game.status = status;
  game.endedAt = new Date();
  game.pending = null;
  game.durationMs = Math.min(game.endedAt - game.startedAt, limitMs);

  if (status === 'won') {
    const remainingSec = Math.max(0, Math.floor((limitMs - game.durationMs) / 1000));
    game.score += remainingSec * game.rules.timeBonusPerSecond;
    game.reward = game.rules.winReward;
  }
  await game.save();

  await User.updateOne(
    { _id: game.user },
    {
      $inc: {
        gamesPlayed: 1,
        gamesWon: status === 'won' ? 1 : 0,
        totalScore: game.score,
        coins: game.reward,
      },
    }
  );
}

async function expireIfNeeded(game) {
  if (game.status === 'active' && Date.now() - game.startedAt.getTime() > game.timeLimit * 1000 + GRACE_MS) {
    await finish(game, 'lost');
    return true;
  }
  return false;
}

async function startGame(user, difficultyKey) {
  const diff = await Difficulty.findOne({ key: difficultyKey, enabled: true });
  if (!diff) throw new HttpError(404, 'Difficulty not available');
  if ((diff.rows * diff.cols) % 2 !== 0) throw new HttpError(500, 'Difficulty grid must have an even number of cards');

  // One live game per player: starting a new one silently retires the old (not counted)
  await Game.updateMany({ user: user._id, status: 'active' }, { status: 'abandoned', endedAt: new Date() });

  const totalPairs = (diff.rows * diff.cols) / 2;
  const game = await Game.create({
    user: user._id,
    difficulty: diff.key,
    rows: diff.rows,
    cols: diff.cols,
    timeLimit: diff.timeLimit,
    totalPairs,
    cards: shuffledDeck(totalPairs),
    matched: new Array(diff.rows * diff.cols).fill(false),
    rules: {
      matchPoints: diff.matchPoints,
      mismatchPenalty: diff.mismatchPenalty,
      streakBonus: diff.streakBonus,
      timeBonusPerSecond: diff.timeBonusPerSecond,
      winReward: diff.winReward,
    },
  });
  return publicView(game);
}

async function loadOwned(gameId, userId) {
  const game = await Game.findById(gameId).select('+cards +rules');
  if (!game || game.user.toString() !== userId.toString()) throw new HttpError(404, 'Game not found');
  return game;
}

async function getGame(gameId, userId) {
  const game = await loadOwned(gameId, userId);
  await expireIfNeeded(game);
  return publicView(game);
}

async function getActiveGame(userId) {
  const game = await Game.findOne({ user: userId, status: 'active' }).select('+cards +rules');
  if (!game) return null;
  if (await expireIfNeeded(game)) return null;
  return publicView(game);
}

function abandonGame(gameId, userId) {
  return withLock(gameId, async () => {
    const game = await loadOwned(gameId, userId);
    if (game.status !== 'active') return publicView(game);
    // Quitting a running game counts as a loss, so it cannot be used to dodge one
    await finish(game, 'lost');
    return publicView(game);
  });
}

function flipCard(gameId, userId, index) {
  return withLock(gameId, async () => {
    const game = await loadOwned(gameId, userId);
    if (await expireIfNeeded(game)) return { expired: true, game: publicView(game) };
    if (game.status !== 'active') throw new HttpError(409, 'Game is over');
    if (!Number.isInteger(index) || index < 0 || index >= game.cards.length) throw new HttpError(400, 'Invalid card');
    if (game.matched[index]) throw new HttpError(409, 'Card already matched');
    if (game.pending === index) throw new HttpError(409, 'Card already flipped');

    const symbol = game.cards[index];

    if (game.pending === null) {
      game.pending = index;
      await game.save();
      return { phase: 'first', index, symbol, game: publicView(game) };
    }

    const firstIndex = game.pending;
    const firstSymbol = game.cards[firstIndex];
    const isMatch = firstSymbol === symbol;
    game.moves += 1;
    game.pending = null;

    if (isMatch) {
      game.matched.set(firstIndex, true);
      game.matched.set(index, true);
      game.pairsFound += 1;
      game.score += game.rules.matchPoints + game.streak * game.rules.streakBonus;
      game.streak += 1;
    } else {
      game.streak = 0;
      game.score = Math.max(0, game.score - game.rules.mismatchPenalty);
    }

    if (game.pairsFound === game.totalPairs) await finish(game, 'won');
    else await game.save();

    return {
      phase: 'second',
      match: isMatch,
      first: { index: firstIndex, symbol: firstSymbol },
      second: { index, symbol },
      game: publicView(game),
    };
  });
}

async function history(userId, page, limit) {
  const filter = { user: userId, status: { $in: ['won', 'lost'] } };
  const [items, total] = await Promise.all([
    Game.find(filter)
      .sort({ endedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('difficulty status moves score pairsFound totalPairs durationMs reward endedAt'),
    Game.countDocuments(filter),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

async function leaderboard(difficulty) {
  const match = { status: 'won' };
  if (difficulty) match.difficulty = difficulty;
  return Game.aggregate([
    { $match: match },
    { $sort: { score: -1, durationMs: 1 } },
    {
      $group: {
        _id: '$user',
        score: { $first: '$score' },
        moves: { $first: '$moves' },
        durationMs: { $first: '$durationMs' },
        difficulty: { $first: '$difficulty' },
      },
    },
    { $sort: { score: -1, durationMs: 1 } },
    { $limit: 20 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
    { $unwind: '$u' },
    { $project: { _id: 0, username: '$u.username', score: 1, moves: 1, durationMs: 1, difficulty: 1 } },
  ]);
}

module.exports = { SYMBOL_COUNT, startGame, getGame, getActiveGame, abandonGame, flipCard, history, leaderboard };
