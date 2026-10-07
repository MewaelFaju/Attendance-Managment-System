const { Router } = require('express');
const { z } = require('zod');
const { User } = require('../models/User.js');
const { Game } = require('../models/Game.js');
const { Difficulty } = require('../models/Difficulty.js');
const { requireAuth, requireAdmin } = require('../middleware/auth.js');
const { validate, validId, wrap } = require('../middleware/validate.js');

const router = Router();
router.use(requireAuth, requireAdmin);

const difficultySchema = z
  .object({
    key: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,20}$/, 'lowercase letters, numbers, - or _'),
    name: z.string().trim().min(1).max(30),
    rows: z.number().int().min(2).max(8),
    cols: z.number().int().min(2).max(8),
    timeLimit: z.number().int().min(10).max(3600),
    matchPoints: z.number().int().min(0).max(10000),
    mismatchPenalty: z.number().int().min(0).max(10000),
    streakBonus: z.number().int().min(0).max(10000),
    timeBonusPerSecond: z.number().int().min(0).max(1000),
    winReward: z.number().int().min(0).max(100000),
    enabled: z.boolean().default(true),
    order: z.number().int().min(0).max(100).default(0),
  })
  .refine((d) => (d.rows * d.cols) % 2 === 0, { message: 'rows x cols must be even', path: ['cols'] })
  .refine((d) => (d.rows * d.cols) / 2 <= 32, { message: 'at most 32 pairs', path: ['cols'] });

const userPatchSchema = z
  .object({
    banned: z.boolean(),
    role: z.enum(['user', 'admin']),
    coins: z.number().int().min(0).max(1e9),
  })
  .partial();

router.get(
  '/stats',
  wrap(async (req, res) => {
    const [users, byStatus, byDifficulty, avg, recent] = await Promise.all([
      User.countDocuments(),
      Game.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Game.aggregate([
        { $match: { status: { $in: ['won', 'lost'] } } },
        {
          $group: {
            _id: '$difficulty',
            played: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
            avgScore: { $avg: '$score' },
            avgMoves: { $avg: '$moves' },
            coinsPaid: { $sum: '$reward' },
          },
        },
      ]),
      Game.aggregate([
        { $match: { status: 'won' } },
        { $group: { _id: null, avgMs: { $avg: '$durationMs' }, avgMoves: { $avg: '$moves' } } },
      ]),
      Game.aggregate([
        { $match: { status: { $in: ['won', 'lost'] }, endedAt: { $gte: new Date(Date.now() - 7 * 864e5) } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$endedAt' } },
            played: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);
    const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
    const finished = (counts.won || 0) + (counts.lost || 0);
    res.json({
      users,
      gamesFinished: finished,
      gamesWon: counts.won || 0,
      gamesLost: counts.lost || 0,
      gamesActive: counts.active || 0,
      winRate: finished ? (counts.won || 0) / finished : 0,
      avgWinTimeMs: avg[0]?.avgMs || 0,
      avgWinMoves: avg[0]?.avgMoves || 0,
      byDifficulty: byDifficulty.map((d) => ({ difficulty: d._id, ...d, _id: undefined })),
      last7Days: recent.map((d) => ({ date: d._id, played: d.played, won: d.won })),
    });
  })
);

router.get(
  '/difficulties',
  wrap(async (req, res) => res.json({ items: await Difficulty.find().sort({ order: 1 }).select('-__v') }))
);

router.post(
  '/difficulties',
  validate(difficultySchema),
  wrap(async (req, res) => {
    if (await Difficulty.exists({ key: req.body.key })) return res.status(409).json({ error: 'Key already exists' });
    res.status(201).json({ item: await Difficulty.create(req.body) });
  })
);

router.put(
  '/difficulties/:id',
  validId(),
  validate(difficultySchema),
  wrap(async (req, res) => {
    const clash = await Difficulty.exists({ key: req.body.key, _id: { $ne: req.params.id } });
    if (clash) return res.status(409).json({ error: 'Key already exists' });
    const item = await Difficulty.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ item });
  })
);

router.delete(
  '/difficulties/:id',
  validId(),
  wrap(async (req, res) => {
    const item = await Difficulty.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  })
);

router.get(
  '/users',
  wrap(async (req, res) => {
    const items = await User.find().sort({ createdAt: -1 }).limit(200).select('-passwordHash -__v');
    res.json({ items });
  })
);

router.patch(
  '/users/:id',
  validId(),
  validate(userPatchSchema),
  wrap(async (req, res) => {
    if (req.params.id === req.user._id.toString() && (req.body.banned || req.body.role === 'user')) {
      return res.status(400).json({ error: 'You cannot demote or ban yourself' });
    }
    const item = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select('-passwordHash -__v');
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ item });
  })
);

router.get(
  '/games',
  wrap(async (req, res) => {
    const items = await Game.find({ status: { $in: ['won', 'lost'] } })
      .sort({ endedAt: -1 })
      .limit(50)
      .populate('user', 'username')
      .select('user difficulty status moves score durationMs reward endedAt');
    res.json({ items });
  })
);

module.exports = router;
