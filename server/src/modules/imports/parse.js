import { extname } from 'node:path';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import yauzl from 'yauzl';

export const LIMITS = {
  bytes: 5 * 1024 * 1024,
  expanded: 25 * 1024 * 1024,
  rows: 5000,
  columns: 50,
  cell: 10000,
  sheets: 10,
  staging: 8 * 1024 * 1024,
};
function invalid(message) {
  throw new Error(message);
}

async function inspectZip(buffer) {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(new Error('Invalid XLSX archive.'));
      let bytes = 0;
      let entries = 0;
      const fail = (message) => {
        zip.close();
        reject(new Error(message));
      };
      zip.on('error', () => fail('Invalid XLSX archive.'));
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        if (
          ++entries > 1000 ||
          entry.generalPurposeBitFlag & 1 ||
          /vbaProject|externalLinks|macrosheets|embeddings/i.test(entry.fileName)
        )
          return fail('Encrypted workbooks, macros and external content are not supported.');
        if (
          entry.uncompressedSize > LIMITS.expanded ||
          bytes + entry.uncompressedSize > LIMITS.expanded
        )
          return fail('Workbook expansion exceeds 25 MiB.');
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail('Invalid XLSX archive.');
          stream.on('error', () => fail('Invalid XLSX archive.'));
          stream.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > LIMITS.expanded) {
              stream.destroy();
              fail('Workbook expansion exceeds 25 MiB.');
            }
          });
          stream.on('end', () => zip.readEntry());
        });
      });
      zip.readEntry();
    });
  });
}

function makeSheet(name, matrix) {
  const headerIndex = matrix.findIndex((row) =>
    row.some((cell) => cell.value.trim() || cell.formula),
  );
  if (headerIndex < 0) return null;
  const header = matrix[headerIndex];
  if (header.some((cell) => cell.formula)) invalid('Column headers cannot contain formulas.');
  const columns = header.map((cell, i) => cell.value.trim().slice(0, 200) || `Column ${i + 1}`);
  // Keep column indices stable, including duplicate and blank header names.
  const width = Math.max(columns.length, ...matrix.map((row) => row.length));
  while (columns.length < width) columns.push(`Column ${columns.length + 1}`);
  return {
    name,
    columns,
    rows: matrix.slice(headerIndex + 1).map((row, i) => ({
      rowNumber: headerIndex + i + 2,
      cells: Array.from({ length: width }, (_, index) => row[index]?.value ?? ''),
      formulaColumns: row.flatMap((cell, index) => (cell.formula ? [index] : [])),
    })),
  };
}

export async function parseContactFile(buffer, filename) {
  if (!buffer.length || buffer.length > LIMITS.bytes)
    invalid('File must be nonempty and no larger than 5 MiB.');
  const extension = extname(filename).toLowerCase();
  let sheets;
  if (extension === '.csv') {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      invalid('CSV files must use UTF-8 encoding.');
    }
    for (const character of text) {
      if (character.charCodeAt(0) < 32 && !'\t\r\n'.includes(character))
        invalid('CSV contains binary or unsupported control characters.');
    }
    const records = parse(text, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
      max_record_size: 512000,
    });
    if (records.length > LIMITS.rows + 1) invalid('Maximum 5,000 data rows per workbook.');
    const matrix = records.map((row) => {
      if (row.length > LIMITS.columns) invalid('Maximum 50 columns.');
      return row.map((value) => {
        if (value.length > LIMITS.cell) invalid('Cell exceeds 10,000 characters.');
        return { value, formula: /^\s*[=+@-]/.test(value) };
      });
    });
    sheets = [makeSheet('CSV', matrix)].filter(Boolean);
  } else {
    if (extension === '.xlsx') {
      if (!buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
        invalid('File content does not match XLSX.');
      await inspectZip(buffer);
    } else if (extension === '.xls') {
      if (!buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')))
        invalid('File content does not match XLS.');
    } else invalid('Only CSV, XLSX and XLS files are supported.');
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellFormula: true,
      bookVBA: true,
      bookFiles: true,
      cellHTML: false,
      cellStyles: false,
    });
    if (
      workbook.vbaraw ||
      workbook.cfb?.FullPaths?.some((path) => /VBA|EncryptedPackage|EncryptionInfo/i.test(path))
    )
      invalid('Macros and encrypted workbooks are not supported.');
    if (workbook.SheetNames.length > LIMITS.sheets) invalid('Maximum 10 worksheets.');
    sheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      if (sheet['!type'] === 'macro') invalid('Macro worksheets are not supported.');
      if (!sheet['!ref']) return null;
      const range = XLSX.utils.decode_range(sheet['!ref']);
      if (range.e.r >= LIMITS.rows + 1 || range.e.c >= LIMITS.columns)
        invalid('Maximum 5,000 rows and 50 columns.');
      const matrix = Array.from({ length: range.e.r + 1 }, (_, r) =>
        Array.from({ length: range.e.c + 1 }, (_, c) => {
          const cell = sheet[XLSX.utils.encode_cell({ r, c })];
          const value = cell ? String(cell.v ?? '') : '';
          if (value.length > LIMITS.cell) invalid('Cell exceeds 10,000 characters.');
          return { value, formula: Boolean(cell?.f) || cell?.t === 'e' };
        }),
      );
      return makeSheet(name, matrix);
    }).filter(Boolean);
  }
  if (!sheets.length) invalid('No header row found.');
  if (sheets.reduce((total, sheet) => total + sheet.rows.length, 0) > LIMITS.rows)
    invalid('Maximum 5,000 data rows across all worksheets.');
  if (Buffer.byteLength(JSON.stringify(sheets)) > LIMITS.staging)
    invalid('Parsed data exceeds the staging limit.');
  return sheets;
}
