import { domainToASCII } from 'node:url';
import { contactFields, contactInputSchema } from '@hirereach/contracts';

const aliases = {
  email: [
    'email',
    'emailaddress',
    'hremail',
    'recruiteremail',
    'recruiteremailaddress',
    'hremailaddress',
    'emailid',
  ],
  hrName: ['hrname', 'name', 'recruitername', 'contactname', 'fullname'],
  companyName: ['company', 'companyname', 'organization', 'organisation', 'employer'],
  designation: ['designation', 'jobtitle', 'title', 'position', 'role'],
};
export function suggestMapping(columns) {
  return Object.fromEntries(
    contactFields.map((field) => {
      const matches = columns.flatMap((column, index) =>
        aliases[field].includes(column.toLowerCase().replace(/[^a-z0-9]/g, '')) ? [index] : [],
      );
      return [field, matches.length === 1 ? matches[0] : null];
    }),
  );
}

export function normalizeContact(input) {
  const values = Object.fromEntries(
    contactFields.map((field) => [
      field,
      String(input[field] ?? '')
        .normalize('NFC')
        .trim(),
    ]),
  );
  const at = values.email.lastIndexOf('@');
  if (at > 0)
    values.email = `${values.email.slice(0, at)}@${domainToASCII(values.email.slice(at + 1)).toLowerCase()}`;
  const result = contactInputSchema.safeParse(values);
  if (!result.success || !/^[\x21-\x7e]+@[a-z\d.-]+$/i.test(values.email)) return null;
  return { ...result.data, emailKey: result.data.email.toLowerCase() };
}

export function cleanRows(rows, mapping, existingKeys = new Set()) {
  const seen = new Set();
  return rows.map((row) => {
    let status = 'valid';
    let reason = '';
    let cleaned;
    const input = Object.fromEntries(
      contactFields.map((field) => [
        field,
        mapping[field] === null ? '' : (row.cells[mapping[field]] ?? ''),
      ]),
    );
    if (row.cells.every((value) => !value.trim()) && !row.formulaColumns.length) {
      status = 'skipped';
      reason = 'EMPTY_ROW';
    } else if (row.formulaColumns.length) {
      status = 'invalid';
      reason = 'FORMULA_CELL';
    } else if (!input.email.trim()) {
      status = 'invalid';
      reason = 'MISSING_EMAIL';
    } else {
      cleaned = normalizeContact(input);
      if (!cleaned) {
        status = 'invalid';
        reason = 'INVALID_EMAIL_OR_FIELDS';
      } else if (existingKeys.has(cleaned.emailKey)) {
        status = 'duplicate';
        reason = 'ALREADY_EXISTS';
      } else if (seen.has(cleaned.emailKey)) {
        status = 'duplicate';
        reason = 'DUPLICATE_IN_FILE';
      }
      if (cleaned) seen.add(cleaned.emailKey);
    }
    return { ...row, status, reason, cleaned: cleaned ?? null };
  });
}

export function countRows(rows) {
  const counts = { total: rows.length, valid: 0, invalid: 0, duplicate: 0, skipped: 0, saved: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}
