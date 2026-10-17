import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadEnvironment } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './infrastructure/database.js';

let server;
let shuttingDown = false;

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    if (server?.listening) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await disconnectDatabase();
    clearTimeout(deadline);
    process.exitCode = exitCode;
  } catch {
    console.error('Shutdown failed.');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => {
  void shutdown(0);
});
process.once('SIGTERM', () => {
  void shutdown(0);
});

let stage = 'configuration';
try {
  const config = loadEnvironment();
  stage = 'database';
  await connectDatabase(config);
  if (!shuttingDown) {
    stage = 'listen';
    server = createServer(
      createApp({ appOrigin: config.APP_ORIGIN, nodeEnv: config.NODE_ENV }),
    );
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.PORT, config.HOST, resolve);
    });
    server.on('error', () => {
      console.error('HTTP server failed.');
      void shutdown(1);
    });
    console.info(`HireReach API listening on port ${config.PORT}`);
  }
} catch (error) {
  const messages = {
    configuration: error.message,
    database:
      'Database startup failed. Check MongoDB availability, credentials, and replica-set configuration.',
    listen: 'HTTP startup failed. Check PORT and whether another process is using it.',
  };
  console.error(messages[stage]);
  await shutdown(1);
}
