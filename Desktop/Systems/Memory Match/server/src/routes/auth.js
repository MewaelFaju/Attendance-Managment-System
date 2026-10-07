const { Router } = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { User } = require('../models/User.js');
const { signToken, requireAuth } = require('../middleware/auth.js');
const { validate, wrap } = require('../middleware/validate.js');

const router = Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false });

const registerSchema = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers and _ only'),
  email: z.string().trim().toLowerCase().email().max(100),
  password: z.string().min(8).max(100),
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(100),
});

const publicUser = (u) => ({
  id: u._id,
  username: u.username,
  email: u.email,
  role: u.role,
  coins: u.coins,
  totalScore: u.totalScore,
  gamesPlayed: u.gamesPlayed,
  gamesWon: u.gamesWon,
});

router.post(
  '/register',
  limiter,
  validate(registerSchema),
  wrap(async (req, res) => {
    const { username, email, password } = req.body;
    if (await User.exists({ $or: [{ email }, { username }] })) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }
    const user = await User.create({ username, email, passwordHash: await bcrypt.hash(password, 12) });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  limiter,
  validate(loginSchema),
  wrap(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    const ok = user && (await bcrypt.compare(req.body.password, user.passwordHash));
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.banned) return res.status(403).json({ error: 'Your account has been suspended' });
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
