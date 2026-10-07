const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { Difficulty } = require('../models/Difficulty.js');
const { requireAuth } = require('../middleware/auth.js');
const { validate, validId, wrap } = require('../middleware/validate.js');
const svc = require('../services/gameService.js');

const router = Router();
router.use(requireAuth);

// A human can't flip faster than a few cards a second; this stops scripted probing of the deck.
const flipLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 30,
  keyGenerator: (req) => req.user._id.toString(),
  message: { error: 'Too many moves, slow down' },
});

const startSchema = z.object({ difficulty: z.string().trim().toLowerCase().min(1).max(30) });
const flipSchema = z.object({ index: z.number().int().min(0).max(63) });

router.get(
  '/difficulties',
  wrap(async (req, res) => {
    const items = await Difficulty.find({ enabled: true }).sort({ order: 1 }).select('-__v');
    res.json({ items });
  })
);

router.post(
  '/start',
  validate(startSchema),
  wrap(async (req, res) => res.status(201).json({ game: await svc.startGame(req.user, req.body.difficulty) }))
);

router.get(
  '/active',
  wrap(async (req, res) => res.json({ game: await svc.getActiveGame(req.user._id) }))
);

router.get(
  '/history',
  wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    res.json(await svc.history(req.user._id, page, limit));
  })
);

router.get(
  '/leaderboard',
  wrap(async (req, res) => {
    const difficulty = typeof req.query.difficulty === 'string' ? req.query.difficulty.toLowerCase() : undefined;
    res.json({ items: await svc.leaderboard(difficulty) });
  })
);

router.get(
  '/:id',
  validId(),
  wrap(async (req, res) => res.json({ game: await svc.getGame(req.params.id, req.user._id) }))
);

router.post(
  '/:id/flip',
  validId(),
  flipLimiter,
  validate(flipSchema),
  wrap(async (req, res) => res.json(await svc.flipCard(req.params.id, req.user._id, req.body.index)))
);

router.post(
  '/:id/abandon',
  validId(),
  wrap(async (req, res) => res.json({ game: await svc.abandonGame(req.params.id, req.user._id) }))
);

module.exports = router;
