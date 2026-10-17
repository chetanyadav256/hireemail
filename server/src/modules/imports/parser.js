import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../../middleware/errors.js';

export function parseInChild(buffer, filename) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./parser.child.js', import.meta.url)), [], {
      execArgv: [
        '--max-old-space-size=128',
        '--permission',
        ...[
          '../../',
          '../../../node_modules',
          '../../../../node_modules',
          '../../../package.json',
          '../../../../package.json',
        ].map((path) => `--allow-fs-read=${fileURLToPath(new URL(path, import.meta.url))}`),
      ],
      env: {
        NODE_ENV: 'production',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    let settled = false;
    const finish = (error, sheets) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(new HttpError(422, 'IMPORT_PARSE_FAILED', error));
      else resolve(sheets);
    };
    const timer = setTimeout(() => finish('Parsing exceeded its 10-second limit.'), 10000);
    child.once('message', (result) => finish(result.error, result.sheets));
    child.once('error', () => finish('Parser unavailable. Please retry.'));
    child.once('exit', () => finish('Parser stopped before completing the file.'));
    child.send({ content: buffer.toString('base64'), filename }, (error) => {
      if (error) finish('Parser unavailable.');
    });
  });
}
