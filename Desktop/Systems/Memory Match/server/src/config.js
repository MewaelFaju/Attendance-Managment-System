require('dotenv/config');

const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGO_URI || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  // Comma-separated list of allowed browser origins (no trailing slash)
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173,https://memorymatch.medtechcom.net')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@playverse.local').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin123!',
};

module.exports = { config };
