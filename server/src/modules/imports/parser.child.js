import { parseContactFile } from './parse.js';

process.once('message', async ({ content, filename }) => {
  try {
    const sheets = await parseContactFile(Buffer.from(content, 'base64'), filename);
    process.send({ sheets }, () => process.exit(0));
  } catch {
    // Parser exceptions can include source-cell content. Never forward or log them.
    process.send(
      {
        error:
          'The file could not be parsed safely. Check its format, limits, encoding, and remove encryption or macros.',
      },
      () => process.exit(0),
    );
  }
});
