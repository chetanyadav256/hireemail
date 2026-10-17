import { loadEnvironment } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../infrastructure/database.js';
import { createContactIndexes } from '../infrastructure/migrations/contact-indexes.js';

try {
  await connectDatabase(loadEnvironment());
  await createContactIndexes();
  console.info('Contact/import indexes are ready.');
} catch {
  console.error(
    'Contact migration failed. Verify database access and resolve duplicate owner/email records before retrying.',
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
