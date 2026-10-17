import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true, versionKey: false },
);

userSchema.index({ email: 1 }, { unique: true, name: 'users_email_unique' });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
