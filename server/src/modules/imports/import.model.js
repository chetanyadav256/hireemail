import mongoose from 'mongoose';

const importSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    filename: { type: String, required: true, maxlength: 150 },
    sha256: { type: String, required: true },
    bytes: { type: Number, required: true },
    sheets: [{ _id: false, name: String, columns: [String], rowCount: Number }],
    sheet: String,
    mapping: { type: Map, of: Number },
    counts: {
      total: Number,
      valid: Number,
      invalid: Number,
      duplicate: Number,
      skipped: Number,
      saved: Number,
    },
    status: { type: String, enum: ['mapping', 'preview', 'completed'], default: 'mapping' },
    version: { type: Number, default: 0 },
    committedVersion: Number,
    committedAt: Date,
    previewExpiresAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    schemaVersion: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false },
);
importSchema.index({ userId: 1, _id: -1 });
importSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const ContactImport =
  mongoose.models.ContactImport ?? mongoose.model('ContactImport', importSchema);

const rowSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    importId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContactImport',
      required: true,
      immutable: true,
    },
    sheet: { type: String, required: true },
    rowNumber: { type: Number, required: true },
    cells: [String],
    formulaColumns: [Number],
    status: {
      type: String,
      enum: ['unmapped', 'valid', 'invalid', 'duplicate', 'skipped'],
      default: 'unmapped',
    },
    reason: String,
    cleaned: {
      email: String,
      emailKey: String,
      hrName: String,
      companyName: String,
      designation: String,
    },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
rowSchema.index({ userId: 1, importId: 1, sheet: 1, rowNumber: 1 }, { unique: true });
rowSchema.index({ userId: 1, importId: 1, sheet: 1, status: 1, rowNumber: 1 });
rowSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const ImportRow = mongoose.models.ImportRow ?? mongoose.model('ImportRow', rowSchema);
