import { AuthRateLimit } from '../../modules/auth/auth-rate-limit.model.js';
import { Session } from '../../modules/auth/session.model.js';
import { User } from '../../modules/auth/user.model.js';

export async function createAuthIndexes() {
  await Promise.all([User.createIndexes(), Session.createIndexes(), AuthRateLimit.createIndexes()]);
}
