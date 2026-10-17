import { AuthRateLimit } from './auth-rate-limit.model.js';
import { Session } from './session.model.js';
import { User } from './user.model.js';

export function createAuthRepository() {
  return {
    async createUser(fields) {
      const user = await User.create(fields);
      return user.toObject();
    },

    async findUserByEmail(email) {
      return User.findOne({ email }).select('+passwordHash').lean();
    },

    async findUserById(id) {
      return User.findById(id).select('-passwordHash').lean();
    },

    async createSession(fields) {
      const session = await Session.create(fields);
      return session.toObject();
    },

    async findSession(tokenHash) {
      return Session.findOne({ tokenHash }).lean();
    },

    async updateSession(tokenHash, fields) {
      return Session.findOneAndUpdate(
        { tokenHash },
        { $set: fields },
        { returnDocument: 'after' },
      ).lean();
    },

    async deleteSession(tokenHash) {
      await Session.deleteOne({ tokenHash });
    },

    async consumeRateLimit(key, expiresAt) {
      try {
        const rateLimit = await AuthRateLimit.findOneAndUpdate(
          { key },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        ).lean();
        return rateLimit.count;
      } catch (error) {
        if (error.code !== 11000) throw error;
        const rateLimit = await AuthRateLimit.findOneAndUpdate(
          { key },
          { $inc: { count: 1 } },
          { returnDocument: 'after' },
        ).lean();
        if (!rateLimit) throw error;
        return rateLimit.count;
      }
    },
  };
}
