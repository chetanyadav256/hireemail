import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx';
import { parseContactFile } from '../src/modules/imports/parse.js';
import { parseInChild } from '../src/modules/imports/parser.js';
import {
  cleanRows,
  countRows,
  normalizeContact,
  suggestMapping,
} from '../src/modules/imports/clean.js';

function spreadsheet(bookType, data) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'People');
  return XLSX.write(workbook, { bookType, type: 'buffer', compression: true });
}
describe('spreadsheet parsing and contact cleaning', () => {
  it('maps aliases, handles UTF-8 BOM/quoted commas, and preserves optional fields', async () => {
    const [sheet] = await parseContactFile(
      Buffer.from(
        '\uFEFFRecruiter Email,HR Name,Company Name,Designation\n  HR@Example.com , Alex ,"Acme, Inc", Recruiter \nsecond@example.com,,,\n',
      ),
      'contacts.csv',
    );
    const mapping = suggestMapping(sheet.columns);
    expect(mapping).toEqual({ email: 0, hrName: 1, companyName: 2, designation: 3 });
    const rows = cleanRows(sheet.rows, mapping);
    expect(rows[0].cleaned).toMatchObject({
      email: 'HR@example.com',
      emailKey: 'hr@example.com',
      hrName: 'Alex',
      companyName: 'Acme, Inc',
      designation: 'Recruiter',
    });
    expect(rows[1].status).toBe('valid');
    expect(rows[1].cleaned.companyName).toBe('');
  });
  it('classifies missing/invalid emails, empty rows and both kinds of duplicates', async () => {
    const [sheet] = await parseContactFile(
      Buffer.from(
        'Email,Company\nnew@example.com,A\nNEW@EXAMPLE.COM,B\nold@example.com,C\nbad,C\n,C\n,\n',
      ),
      'c.csv',
    );
    const rows = cleanRows(sheet.rows, suggestMapping(sheet.columns), new Set(['old@example.com']));
    expect(countRows(rows)).toEqual({
      total: 6,
      valid: 1,
      invalid: 2,
      duplicate: 2,
      skipped: 1,
      saved: 0,
    });
    expect(rows.map((row) => row.reason)).toEqual([
      '',
      'DUPLICATE_IN_FILE',
      'ALREADY_EXISTS',
      'INVALID_EMAIL_OR_FIELDS',
      'MISSING_EMAIL',
      'EMPTY_ROW',
    ]);
  });
  it.each([
    ['xlsx', 'xlsx'],
    ['biff8', 'xls'],
  ])('reads real %s workbooks including optional blanks', async (format, extension) => {
    const [sheet] = await parseContactFile(
      spreadsheet(format, [
        ['HR Email', 'HR Name'],
        ['hr@example.com', ''],
      ]),
      `contacts.${extension}`,
    );
    expect(cleanRows(sheet.rows, suggestMapping(sheet.columns))[0]).toMatchObject({
      status: 'valid',
      cleaned: { email: 'hr@example.com', hrName: '' },
    });
  });
  it('requires manual mapping when email aliases are ambiguous', () => {
    expect(suggestMapping(['Email', 'HR Email']).email).toBeNull();
    expect(suggestMapping(['Unknown', 'Company']).email).toBeNull();
  });
  it('normalizes domains without merging plus tags or dots', () => {
    expect(normalizeContact({ email: ' Person+job@EXAMPLE.COM ' })).toMatchObject({
      email: 'Person+job@example.com',
      emailKey: 'person+job@example.com',
    });
    expect(normalizeContact({ email: 'a.b@example.com' }).emailKey).toBe('a.b@example.com');
    expect(normalizeContact({ email: 'a@example.com\r\nBcc:other@example.com' })).toBeNull();
  });
  it('does not evaluate workbook or CSV formulas', async () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Email', 'Company'],
      ['a@example.com', 'cached'],
    ]);
    sheet.B2.f = 'HYPERLINK("https://example.invalid","cached")';
    XLSX.utils.book_append_sheet(book, sheet, 'Contacts');
    const [parsed] = await parseContactFile(
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
      'a.xlsx',
    );
    expect(cleanRows(parsed.rows, suggestMapping(parsed.columns))[0].reason).toBe('FORMULA_CELL');
    const [csv] = await parseContactFile(Buffer.from('Email,Company\na@example.com,=1+1'), 'a.csv');
    expect(cleanRows(csv.rows, suggestMapping(csv.columns))[0].reason).toBe('FORMULA_CELL');
  });
  it('rejects spoofed, binary, malformed and oversized inputs', async () => {
    await expect(parseContactFile(Buffer.from('Email\na@example.com'), 'a.xlsx')).rejects.toThrow();
    await expect(parseContactFile(Buffer.from([0, 0xff]), 'a.csv')).rejects.toThrow();
    await expect(parseContactFile(Buffer.from('Email\n"unclosed'), 'a.csv')).rejects.toThrow();
    await expect(parseContactFile(Buffer.alloc(5 * 1024 * 1024 + 1), 'a.csv')).rejects.toThrow();
    await expect(
      parseContactFile(Buffer.from('Email\n' + 'a@example.com\n'.repeat(5001)), 'a.csv'),
    ).rejects.toThrow();
    await expect(
      parseContactFile(Buffer.from(Array(51).fill('column').join(',')), 'a.csv'),
    ).rejects.toThrow();
  });
  it('rejects oversized ZIP expansion before spreadsheet decoding', async () => {
    const file = spreadsheet('xlsx', [
      ['Email'],
      ...Array.from({ length: 900 }, () => ['x'.repeat(30000)]),
    ]);
    await expect(parseContactFile(file, 'bomb.xlsx')).rejects.toThrow('expansion');
  });
  it('rejects VBA-bearing and encrypted workbooks', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['Email'], ['hr@example.test']]),
      'Contacts',
    );
    workbook.vbaraw = Buffer.from('synthetic-vba-placeholder');
    const macroFile = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsm' });
    await expect(parseContactFile(macroFile, 'renamed.xlsx')).rejects.toThrow(/macro/i);
    const archive = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(
      archive,
      'EncryptedPackage',
      Buffer.from('synthetic-encrypted-placeholder'),
    );
    XLSX.CFB.utils.cfb_add(archive, 'EncryptionInfo', Buffer.alloc(16));
    await expect(
      parseContactFile(XLSX.CFB.write(archive, { type: 'buffer' }), 'encrypted.xls'),
    ).rejects.toThrow();
  });
  it('runs parsing in a separate process and redacts parser failures', async () => {
    expect((await parseInChild(Buffer.from('Email\na@example.com'), 'c.csv'))[0].rows).toHaveLength(
      1,
    );
    expect(
      (await parseInChild(spreadsheet('biff8', [['Email'], ['hr@example.test']]), 'legacy.xls'))[0]
        .rows,
    ).toHaveLength(1);
    await expect(
      parseInChild(Buffer.from('Email\n"private-secret-cell'), 'c.csv'),
    ).rejects.toMatchObject({ code: 'IMPORT_PARSE_FAILED' });
  });
});
