import mongoose from 'mongoose';

mongoose.set('bufferCommands', false);

export async function connectDatabase(config) {
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: config.MONGODB_TIMEOUT_MS,
    connectTimeoutMS: config.MONGODB_TIMEOUT_MS,
    autoIndex: config.NODE_ENV !== 'production',
    maxPoolSize: 10,
  });
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== 'isdbgrid') {
    await mongoose.disconnect();
    throw new Error('MongoDB must be a replica set or sharded cluster.');
  }
}

export async function isDatabaseReady() {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await mongoose.connection.db.admin().command({ ping: 1 }, { timeoutMS: 1500 });
    return true;
  } catch {
    return false;
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
