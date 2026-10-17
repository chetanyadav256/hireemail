import mongoose from 'mongoose';

const authRateLimitSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, collection: 'auth_rate_limits' },
);

authRateLimitSchema.index({ key: 1 }, { unique: true, name: 'auth_rate_limit_key_unique' });
authRateLimitSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'auth_rate_limit_expiry_ttl' },
);

export const AuthRateLimit =
  mongoose.models.AuthRateLimit ?? mongoose.model('AuthRateLimit', authRateLimitSchema);
