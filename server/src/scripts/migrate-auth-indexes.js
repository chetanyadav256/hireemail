import { connectDatabase, disconnectDatabase } from '../infrastructure/database.js';
import { createAuthIndexes } from '../infrastructure/migrations/auth-indexes.js';
import { loadEnvironment } from '../config/env.js';

let connected = false;
try {
  const config = loadEnvironment();
  await connectDatabase(config);
  connected = true;
  await createAuthIndexes();
  console.info('Authentication indexes are ready.');
}catch (error) {
  console.error("Authentication migration failed!");
  console.error("Error name:", error.name);
  console.error("Error code:", error.code);
  console.error("Error message:", error.message);
  process.exitCode = 1;
} finally {
  if (connected) await disconnectDatabase();
}
