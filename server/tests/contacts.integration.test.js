import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import XLSX from 'xlsx';
import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/infrastructure/database.js';
import { createAuthIndexes } from '../src/infrastructure/migrations/auth-indexes.js';
import { createContactIndexes } from '../src/infrastructure/migrations/contact-indexes.js';
import { createSession } from '../src/modules/auth/auth.middleware.js';
import { Session } from '../src/modules/auth/session.model.js';
import { User } from '../src/modules/auth/user.model.js';
import { AuthRateLimit } from '../src/modules/auth/auth-rate-limit.model.js';
import { Contact, ContactOwnerState } from '../src/modules/contacts/contact.model.js';
import { ContactImport, ImportRow } from '../src/modules/imports/import.model.js';

it.skipIf(!process.env.TEST_MONGODB_URI)(
  'imports with real ownership, preview, concurrent dedupe, edits, pagination and durable history',
  async () => {
    await connectDatabase({
      MONGODB_URI: process.env.TEST_MONGODB_URI,
      MONGODB_TIMEOUT_MS: 5000,
      NODE_ENV: 'test',
    });
    const owners = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const appOrigin = 'http://localhost:5173';
    try {
      await createAuthIndexes();
      await createContactIndexes();
      const app = createApp({ appOrigin, nodeEnv: 'test' });
      const sessions = [];
      for (const userId of owners) {
        await User.create({
          _id: userId,
          name: 'Synthetic Contact Owner',
          email: `${userId}@example.test`,
          passwordHash: 'test-only-never-used-for-login',
        });
        const session = createSession({
          userId,
          now: new Date(),
          token: randomBytes(32).toString('base64url'),
          csrfToken: randomBytes(32).toString('base64url'),
        });
        await Session.create(session);
        sessions.push(session);
      }
      function call(method, path, index = 0) {
        const apiRequest = request(app);
        return apiRequest[method](`/api/v1${path}`)
          .set('Cookie', `hirereach.sid=${sessions[index].token}`)
          .set('Origin', appOrigin)
          .set('X-CSRF-Token', sessions[index].csrfToken);
      }
      const mapping = { email: 0, hrName: 1, companyName: 2, designation: 3 };
      async function upload(text, index = 0) {
        return (
          await call('post', '/contact-imports', index)
            .attach('file', Buffer.from(text), 'contacts.csv')
            .expect(201)
        ).body.data;
      }
      async function uploadBuffer(buffer, filename, index = 0) {
        return (
          await call('post', '/contact-imports', index).attach('file', buffer, filename).expect(201)
        ).body.data;
      }
      async function preview(record, index = 0) {
        return (
          await call('post', `/contact-imports/${record.id}/preview`, index)
            .send({ expectedVersion: record.version, sheet: 'CSV', mapping })
            .expect(200)
        ).body.data;
      }
      const csv =
        'HR Email,HR Name,Company,Designation\nfirst@example.com,First,Acme,HR\nFIRST@example.com,Duplicate,,\ninvalid,Invalid,,\n,,,\nsecond@example.com,,,\n';
      const staged = await upload(csv);
      expect(await Contact.countDocuments({ userId: owners[0] })).toBe(0);
      await call('post', `/contact-imports/${staged.id}/commit`)
        .send({ expectedVersion: 0 })
        .expect(409);
      await call('post', `/contact-imports/${staged.id}/preview`)
        .send({ expectedVersion: 0, sheet: 'CSV', mapping: { ...mapping, hrName: 0 } })
        .expect(422);
      const reviewed = await preview(staged);
      expect(reviewed.counts).toMatchObject({
        total: 5,
        valid: 2,
        duplicate: 1,
        invalid: 1,
        skipped: 1,
      });
      const invalidRows = (
        await call('get', `/contact-imports/${staged.id}/rows?status=invalid`).expect(200)
      ).body;
      expect(invalidRows.meta.total).toBe(1);
      expect(invalidRows.data[0]).toMatchObject({
        values: { email: 'invalid' },
        reason: 'INVALID_EMAIL_OR_FIELDS',
      });
      expect(invalidRows.data[0]).not.toHaveProperty('cells');
      await call('post', `/contact-imports/${staged.id}/commit`)
        .send({ expectedVersion: 0 })
        .expect(409);
      const commits = await Promise.all(
        [0, 1].map(() =>
          call('post', `/contact-imports/${staged.id}/commit`)
            .send({ expectedVersion: reviewed.version })
            .expect(200),
        ),
      );
      expect(commits[0].body.data.counts.saved).toBe(2);
      expect(await Contact.countDocuments({ userId: owners[0] })).toBe(2);
      await expect(
        Contact.create({
          userId: owners[0],
          email: 'first@example.com',
          emailKey: 'first@example.com',
          sourceImportId: staged.id,
          sourceRow: 2,
        }),
      ).rejects.toMatchObject({ code: 11000 });
      await call('get', `/contact-imports/${staged.id}`, 1).expect(404);
      await call('get', `/contact-imports/${staged.id}/rows`, 1).expect(404);
      await call('post', `/contact-imports/${staged.id}/commit`, 1)
        .send({ expectedVersion: reviewed.version })
        .expect(404);
      expect((await call('get', '/contacts', 1)).body.meta.total).toBe(0);
      const separate = await preview(await upload(csv, 1), 1);
      expect(separate.counts.valid).toBe(2);
      await call('post', `/contact-imports/${separate.id}/commit`, 1)
        .send({ expectedVersion: separate.version })
        .expect(200);
      const racingCSV = 'HR Email,HR Name,Company,Designation\nrace@example.com,Race,Acme,HR';
      const firstRace = await preview(await upload(racingCSV));
      const secondRace = await preview(await upload(racingCSV));
      const raced = await Promise.all(
        [firstRace, secondRace].map((record) =>
          call('post', `/contact-imports/${record.id}/commit`)
            .send({ expectedVersion: record.version })
            .expect(200),
        ),
      );
      expect(raced.map((response) => response.body.data.counts.saved).sort()).toEqual([0, 1]);
      const list = (await call('get', '/contacts?search=first&limit=1').expect(200)).body;
      expect(list.meta.total).toBe(1);
      const contact = list.data[0];
      const edit = {
        expectedVersion: contact.version,
        email: contact.email,
        hrName: 'Updated',
        companyName: 'New Company',
        designation: '',
      };
      await call('patch', `/contacts/${contact.id}`, 1).send(edit).expect(404);
      await call('delete', `/contacts/${contact.id}`, 1).send({ expectedVersion: 0 }).expect(404);
      const edited = (await call('patch', `/contacts/${contact.id}`).send(edit).expect(200)).body
        .data;
      await call('patch', `/contacts/${contact.id}`).send(edit).expect(409);
      await call('patch', `/contacts/${contact.id}`)
        .send({ ...edit, expectedVersion: edited.version, email: 'second@example.com' })
        .expect(409);
      await call('delete', `/contacts/${contact.id}`)
        .send({ expectedVersion: edited.version })
        .expect(204);
      expect((await call('get', '/contacts?status=archived')).body.meta.total).toBe(1);
      const duplicated = await preview(await upload(csv));
      expect(duplicated.counts.duplicate).toBe(3);
      const stats = (await call('get', '/contacts/statistics')).body.data;
      expect(stats).toMatchObject({ total: 3, active: 2, archived: 1, imports: 4 });
      await call('patch', `/contacts/${contact.id}`)
        .send({ ...edit, expectedVersion: edited.version + 1, archived: false })
        .expect(200);
      expect(
        (await call('get', '/contacts?company=New%20Company&status=active')).body.meta.total,
      ).toBe(1);
      const history = (await call('get', '/contact-imports?limit=1&page=2')).body;
      expect(history.meta.total).toBe(4);
      expect(history.data).toHaveLength(1);
      await ContactImport.updateOne(
        { _id: duplicated.id, userId: owners[0] },
        { previewExpiresAt: new Date(0) },
      );
      await call('post', `/contact-imports/${duplicated.id}/commit`)
        .send({ expectedVersion: duplicated.version })
        .expect(410);
      await call('get', `/contact-imports/${duplicated.id}/rows`).expect(410);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['Email Address', 'Organization'],
          ['sheet@example.test', 'Sheet Co'],
        ]),
        'Recruiters',
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['Email', 'Company'],
          ['ignored@example.test', 'Other Co'],
        ]),
        'Do not import',
      );
      const excelImport = await uploadBuffer(
        XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
        'recruiters.xlsx',
      );
      expect(excelImport.sheets.map((sheet) => sheet.name)).toEqual([
        'Recruiters',
        'Do not import',
      ]);
      const excelPreview = await call('post', `/contact-imports/${excelImport.id}/preview`)
        .send({
          expectedVersion: excelImport.version,
          sheet: 'Recruiters',
          mapping: { email: 0, hrName: null, companyName: 1, designation: null },
        })
        .expect(200);
      expect(excelPreview.body.data.counts.valid).toBe(1);
      await call('post', `/contact-imports/${excelImport.id}/commit`)
        .send({ expectedVersion: excelPreview.body.data.version })
        .expect(200);
      expect(
        await Contact.findOne({ userId: owners[0], email: 'sheet@example.test' }).lean(),
      ).toMatchObject({ companyName: 'Sheet Co', hrName: '' });
    } finally {
      for (const model of [Contact, ContactImport, ImportRow, ContactOwnerState, Session])
        await model.deleteMany({ userId: { $in: owners } });
      await User.deleteMany({ _id: { $in: owners } });
      await AuthRateLimit.deleteMany({ key: { $regex: `^contacts:.*:(${owners.join('|')}):` } });
      await disconnectDatabase();
    }
  },
  60000,
);
