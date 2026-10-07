const mongoose = require('mongoose');

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    });
  }
  req.body = result.data;
  next();
};

const validId = (param = 'id') => (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params[param])) return res.status(400).json({ error: 'Invalid id' });
  next();
};

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { validate, validId, wrap, HttpError };
