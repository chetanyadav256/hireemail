import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { HttpError } from '../../middleware/errors.js';
import { cleanRows, countRows, normalizeContact, suggestMapping } from '../imports/clean.js';
import { parseInChild } from '../imports/parser.js';

const DAY = 86400000;
const notFound = () => new HttpError(404, 'NOT_FOUND', 'This resource does not exist.');
const conflict = () =>
  new HttpError(409, 'VERSION_CONFLICT', 'This record changed. Reload it before continuing.');
export function publicContact(row) {
  return {
    id: String(row._id),
    email: row.email,
    hrName: row.hrName,
    companyName: row.companyName,
    designation: row.designation,
    version: row.version,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
  };
}
export function publicImport(row) {
  return {
    id: String(row._id),
    filename: row.filename,
    sheets: row.sheets,
    sheet: row.sheet,
    mapping: row.mapping instanceof Map ? Object.fromEntries(row.mapping) : row.mapping,
    counts: row.counts,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    committedAt: row.committedAt,
    previewExpiresAt: row.previewExpiresAt,
    expired: new Date(row.previewExpiresAt) <= new Date(),
  };
}
function validateImport(record, expectedVersion, now) {
  if (!record || new Date(record.expiresAt) <= now) throw notFound();
  if (new Date(record.previewExpiresAt) <= now)
    throw new HttpError(410, 'IMPORT_EXPIRED', 'The preview expired. Upload the file again.');
  if (record.status === 'completed' || record.version !== expectedVersion) throw conflict();
}

export function createContactService({
  repository,
  parser = parseInChild,
  clock = () => new Date(),
}) {
  async function importRecord(userId, id) {
    const record = await repository.findImport(userId, id);
    if (!record || new Date(record.expiresAt) <= clock()) throw notFound();
    return record;
  }
  async function classify(tx, userId, record, mapping, sheet) {
    const rows = await tx.getRows(userId, record._id, sheet);
    const metadata = record.sheets.find((item) => item.name === sheet);
    if (!metadata || rows.length !== metadata.rowCount)
      throw new HttpError(410, 'IMPORT_EXPIRED', 'Preview rows are unavailable. Upload again.');
    const preliminary = cleanRows(rows, mapping);
    const keys = preliminary.flatMap((row) => (row.cleaned ? [row.cleaned.emailKey] : []));
    const existing = await tx.existingKeys(userId, keys);
    return cleanRows(rows, mapping, existing);
  }
  return {
    async upload(userId, file) {
      const sheets = await parser(file.buffer, file.originalname);
      const now = clock();
      const record = await repository.transaction(userId, async (tx) => {
        if ((await tx.pendingImports(userId, now)) >= 5)
          throw new HttpError(
            429,
            'IMPORT_LIMIT',
            'You already have five pending imports. Save an import or wait for its preview to expire.',
          );
        const previewExpiresAt = new Date(now.getTime() + DAY);
        const saved = await tx.createImport({
          userId,
          filename: [...basename(file.originalname.replaceAll('\\', '/'))]
            .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
            .join('')
            .slice(0, 150),
          bytes: file.buffer.length,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          sheets: sheets.map((sheet) => ({
            name: sheet.name,
            columns: sheet.columns,
            rowCount: sheet.rows.length,
          })),
          previewExpiresAt,
          expiresAt: new Date(now.getTime() + 90 * DAY),
        });
        await tx.insertRows(
          sheets.flatMap((sheet) =>
            sheet.rows.map((row) => ({
              ...row,
              userId,
              importId: saved._id,
              sheet: sheet.name,
              expiresAt: previewExpiresAt,
            })),
          ),
        );
        return saved;
      });
      return { ...publicImport(record), suggestedMapping: suggestMapping(sheets[0].columns) };
    },
    async preview(userId, id, input) {
      return repository.transaction(userId, async (tx) => {
        const record = await tx.findImport(userId, id);
        validateImport(record, input.expectedVersion, clock());
        const sheet = record.sheets.find((item) => item.name === input.sheet);
        const indices = Object.values(input.mapping).filter((value) => value !== null);
        if (
          !sheet ||
          indices.some((index) => index >= sheet.columns.length) ||
          new Set(indices).size !== indices.length
        )
          throw new HttpError(
            422,
            'INVALID_MAPPING',
            'Choose distinct columns from the selected worksheet.',
          );
        const rows = await classify(tx, userId, record, input.mapping, input.sheet);
        await tx.updateRows(userId, id, rows);
        return publicImport(
          await tx.updateImport(userId, id, {
            mapping: input.mapping,
            sheet: input.sheet,
            counts: countRows(rows),
            status: 'preview',
            version: record.version + 1,
          }),
        );
      });
    },
    async commit(userId, id, expectedVersion) {
      return repository.transaction(userId, async (tx) => {
        const record = await tx.findImport(userId, id);
        if (
          record?.status === 'completed' &&
          record.committedVersion === expectedVersion &&
          new Date(record.expiresAt) > clock()
        )
          return publicImport(record);
        validateImport(record, expectedVersion, clock());
        if (record.status !== 'preview')
          throw new HttpError(409, 'PREVIEW_REQUIRED', 'Review a mapped preview before saving.');
        const rows = await classify(tx, userId, record, record.mapping, record.sheet);
        const valid = rows.filter((row) => row.status === 'valid');
        if ((await tx.countContacts(userId)) + valid.length > 50000)
          throw new HttpError(
            409,
            'CONTACT_LIMIT',
            'This workspace has reached its 50,000 contact limit.',
          );
        await tx.insertContacts(
          valid.map((row) => ({
            ...row.cleaned,
            userId,
            sourceImportId: record._id,
            sourceRow: row.rowNumber,
          })),
        );
        await tx.updateRows(userId, id, rows);
        return publicImport(
          await tx.updateImport(userId, id, {
            counts: { ...countRows(rows), saved: valid.length },
            status: 'completed',
            committedVersion: expectedVersion,
            version: record.version + 1,
            committedAt: clock(),
          }),
        );
      });
    },
    async getImport(userId, id) {
      return publicImport(await importRecord(userId, id));
    },
    async listImports(userId, query) {
      const result = await repository.listImports(userId, query);
      return { ...result, items: result.items.map(publicImport) };
    },
    async rows(userId, id, query) {
      const record = await importRecord(userId, id);
      if (new Date(record.previewExpiresAt) <= clock())
        throw new HttpError(
          410,
          'IMPORT_EXPIRED',
          'Preview rows have expired; import counts remain available.',
        );
      if (!record.sheet) throw new HttpError(409, 'PREVIEW_REQUIRED', 'Map the columns first.');
      const result = await repository.listRows(userId, id, record.sheet, query);
      return {
        ...result,
        items: result.items.map((row) => ({
          rowNumber: row.rowNumber,
          status: row.status,
          reason: row.reason,
          cleaned: row.cleaned,
          values: Object.fromEntries(
            Object.entries(record.mapping).map(([field, column]) => [
              field,
              column === null ? '' : (row.cells[column] ?? '').slice(0, 254),
            ]),
          ),
        })),
      };
    },
    async list(userId, query) {
      const result = await repository.listContacts(userId, query);
      return { ...result, items: result.items.map(publicContact) };
    },
    statistics: (userId) => repository.statistics(userId),
    async edit(userId, id, input) {
      return repository.transaction(userId, async (tx) => {
        const record = await tx.findContact(userId, id);
        if (!record) throw notFound();
        if (record.version !== input.expectedVersion) throw conflict();
        const normalized = normalizeContact({
          email: input.email,
          hrName: input.hrName,
          companyName: input.companyName,
          designation: input.designation,
        });
        if (!normalized)
          throw new HttpError(422, 'INVALID_CONTACT', 'Enter a valid email and text fields.');
        if (
          normalized.emailKey !== record.emailKey &&
          (await tx.existingKeys(userId, [normalized.emailKey])).size
        )
          throw new HttpError(
            409,
            'DUPLICATE_CONTACT',
            'This email already exists in your contacts, including deleted contacts.',
          );
        return publicContact(
          await tx.updateContact(userId, id, {
            ...normalized,
            archivedAt:
              input.archived === undefined ? record.archivedAt : input.archived ? clock() : null,
            version: record.version + 1,
          }),
        );
      });
    },
    async remove(userId, id, expectedVersion) {
      return repository.transaction(userId, async (tx) => {
        const record = await tx.findContact(userId, id);
        if (!record) throw notFound();
        if (record.version !== expectedVersion) throw conflict();
        await tx.updateContact(userId, id, { archivedAt: clock(), version: record.version + 1 });
      });
    },
  };
}
