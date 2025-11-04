// backend/src/models/User.js

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false, // Don't include password in query results by default
    },
    isAdmin: {
      type: Boolean,
      required: true,
      default: true, // Assuming all users are admins for this system
    },
  },
  {
    timestamps: true,
  }
);

/**
 * --- Pre-save Middleware ---
 * Hashes the user's password using bcrypt before saving it
 * to the database. Only runs if the password has been modified.
 */
userSchema.pre('save', async function (next) {
  // 'this.isModified' checks if the password field was changed
  if (!this.isModified('password')) {
    return next();
  }

  // Hash the password
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/**
 * --- Model Method: checkPassword ---
 * Compares a candidate password with the user's hashed password.
 * @param {string} candidatePassword - The plain-text password to check.
 * @returns {Promise<boolean>} - True if the passwords match, false otherwise.
 */
userSchema.methods.checkPassword = async function (candidatePassword) {
  // 'this.password' has been selected from the DB (see authController)
  return await bcrypt.compare(candidatePassword, this.password);
};

/**
 * --- Model Method: getSignedJwtToken ---
 * Generates a JSON Web Token (JWT) for the user.
 * @returns {string} - A signed JWT.
 */
userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign(
    { id: this._id, email: this.email }, // Payload
    env.JWT_SECRET, // Secret
    { expiresIn: env.JWT_EXPIRES_IN } // Expiry
  );
};

const User = mongoose.model('User', userSchema);

export default User;