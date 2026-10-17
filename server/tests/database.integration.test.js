import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  connectDatabase,
  disconnectDatabase,
  isDatabaseReady,
} from '../src/infrastructure/database.js';

it.skipIf(!process.env.TEST_MONGODB_URI)(
  'connects to a real replica set and rolls back a transaction',
  async () => {
    await connectDatabase({
      MONGODB_URI: process.env.TEST_MONGODB_URI,
      MONGODB_TIMEOUT_MS: 5000,
      NODE_ENV: 'test',
    });
    const collectionName = `setup_check_${randomUUID().replaceAll('-', '')}`;
    let session;
    try {
      expect(await isDatabaseReady()).toBe(true);
      const collection = await mongoose.connection.db.createCollection(collectionName);
      session = await mongoose.startSession();
      session.startTransaction();
      await collection.insertOne({ synthetic: true }, { session });
      await session.abortTransaction();
      expect(await collection.countDocuments()).toBe(0);
    } finally {
      await session?.endSession();
      await mongoose.connection.db
        .collection(collectionName)
        .drop()
        .catch(() => {});
      await disconnectDatabase();
    }
  },
);
