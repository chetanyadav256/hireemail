import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    csrfToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false, collection: 'sessions' },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'sessions_token_hash_unique' });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'sessions_expiry_ttl' });
sessionSchema.index({ userId: 1 }, { name: 'sessions_user_id' });

export const Session = mongoose.models.Session ?? mongoose.model('Session', sessionSchema);
