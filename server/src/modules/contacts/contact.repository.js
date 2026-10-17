import mongoose from 'mongoose';
import { Contact, ContactOwnerState } from './contact.model.js';
import { ContactImport, ImportRow } from '../imports/import.model.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const options = (session) => (session ? { session } : {});
function bind(session) {
  return {
    async findImport(userId, id) {
      return ContactImport.findOne({ userId, _id: id }, null, options(session)).lean();
    },
    async createImport(data) {
      return (await ContactImport.create([data], options(session)))[0].toObject({
        flattenMaps: true,
      });
    },
    async insertRows(rows) {
      if (rows.length) await ImportRow.insertMany(rows, options(session));
    },
    async getRows(userId, importId, sheet) {
      return ImportRow.find({ userId, importId, sheet }, null, options(session))
        .sort({ rowNumber: 1 })
        .lean();
    },
    async updateImport(userId, id, fields) {
      return ContactImport.findOneAndUpdate(
        { userId, _id: id },
        { $set: fields },
        { ...options(session), returnDocument: 'after' },
      ).lean();
    },
    async updateRows(userId, importId, rows) {
      if (!rows.length) return;
      await ImportRow.bulkWrite(
        rows.map((row) => ({
          updateOne: {
            filter: { userId, importId, _id: row._id },
            update: { $set: { status: row.status, reason: row.reason, cleaned: row.cleaned } },
          },
        })),
        options(session),
      );
    },
    async existingKeys(userId, keys) {
      return new Set(
        (
          await Contact.find(
            { userId, emailKey: { $in: keys } },
            { emailKey: 1 },
            options(session),
          ).lean()
        ).map((row) => row.emailKey),
      );
    },
    async insertContacts(rows) {
      if (rows.length) await Contact.insertMany(rows, options(session));
    },
    async countContacts(userId) {
      return Contact.countDocuments({ userId }).session(session ?? null);
    },
    async pendingImports(userId, now) {
      return ContactImport.countDocuments({
        userId,
        status: { $ne: 'completed' },
        previewExpiresAt: { $gt: now },
      }).session(session ?? null);
    },
    async findContact(userId, id) {
      return Contact.findOne({ userId, _id: id }, null, options(session)).lean();
    },
    async updateContact(userId, id, fields) {
      return Contact.findOneAndUpdate(
        { userId, _id: id },
        { $set: fields },
        { ...options(session), returnDocument: 'after', runValidators: true },
      ).lean();
    },
  };
}

export function createContactRepository() {
  return {
    ...bind(),
    async transaction(userId, work) {
      try {
        await ContactOwnerState.updateOne(
          { userId },
          { $setOnInsert: { revision: 0 } },
          { upsert: true },
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
      return mongoose.connection.transaction(async (session) => {
        await ContactOwnerState.updateOne({ userId }, { $inc: { revision: 1 } }, { session });
        return work(bind(session));
      });
    },
    async listContacts(userId, query) {
      const filter = { userId };
      if (query.status !== 'all')
        filter.archivedAt = query.status === 'active' ? null : { $ne: null };
      if (query.company) filter.companyName = query.company;
      if (query.importId) filter.sourceImportId = query.importId;
      if (query.search)
        filter.$or = ['hrName', 'email', 'companyName'].map((field) => ({
          [field]: { $regex: escapeRegex(query.search), $options: 'i' },
        }));
      const [items, total] = await Promise.all([
        Contact.find(filter)
          .sort({ _id: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .maxTimeMS(3000)
          .lean(),
        Contact.countDocuments(filter).maxTimeMS(3000),
      ]);
      return { items, total };
    },
    async listImports(userId, query) {
      const filter = { userId, expiresAt: { $gt: new Date() } };
      const [items, total] = await Promise.all([
        ContactImport.find(filter)
          .sort({ _id: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
        ContactImport.countDocuments(filter),
      ]);
      return { items, total };
    },
    async listRows(userId, importId, sheet, query) {
      const filter = { userId, importId, sheet, expiresAt: { $gt: new Date() } };
      if (query.status !== 'all') filter.status = query.status;
      const [items, total] = await Promise.all([
        ImportRow.find(filter)
          .select('-formulaColumns')
          .sort({ rowNumber: 1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
        ImportRow.countDocuments(filter),
      ]);
      return { items, total };
    },
    async statistics(userId) {
      const owner = new mongoose.Types.ObjectId(userId);
      const [total, archived, companies, summaries] = await Promise.all([
        Contact.countDocuments({ userId }),
        Contact.countDocuments({ userId, archivedAt: { $ne: null } }),
        Contact.distinct('companyName', {
          userId,
          archivedAt: null,
          companyName: { $ne: '' },
        }).maxTimeMS(3000),
        ContactImport.aggregate([
          { $match: { userId: owner, expiresAt: { $gt: new Date() } } },
          {
            $group: {
              _id: null,
              imports: { $sum: 1 },
              saved: { $sum: '$counts.saved' },
              duplicates: { $sum: '$counts.duplicate' },
            },
          },
        ]).option({ maxTimeMS: 3000 }),
      ]);
      return {
        total,
        active: total - archived,
        archived,
        companies: companies.sort().slice(0, 200),
        imports: summaries[0]?.imports ?? 0,
        saved: summaries[0]?.saved ?? 0,
        duplicates: summaries[0]?.duplicates ?? 0,
      };
    },
  };
}
