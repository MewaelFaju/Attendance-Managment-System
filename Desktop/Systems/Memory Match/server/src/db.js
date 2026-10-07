const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { config } = require('./config.js');
const { User } = require('./models/User.js');
const { Difficulty, DEFAULT_DIFFICULTIES } = require('./models/Difficulty.js');

async function connectDb() {
  let uri = config.mongoUri;
  if (!uri) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
    uri = mem.getUri('memorymatch');
    console.log('[db] MONGO_URI not set - using in-memory MongoDB (data is not persisted)');
  }
  await mongoose.connect(uri);
  console.log('[db] connected');
  await seed();
}

async function seed() {
  if ((await Difficulty.countDocuments()) === 0) {
    await Difficulty.insertMany(DEFAULT_DIFFICULTIES);
    console.log('[db] seeded default difficulties');
  }
  if (!(await User.exists({ email: config.adminEmail }))) {
    await User.create({
      username: 'admin',
      email: config.adminEmail,
      passwordHash: await bcrypt.hash(config.adminPassword, 12),
      role: 'admin',
    });
    console.log(`[db] created admin ${config.adminEmail}`);
  }
}

module.exports = { connectDb };
