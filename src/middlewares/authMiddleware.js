import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { HTTP_STATUS } from '../utils/constants.js';
import User from '../models/User.js'; // --- ADDED: Import the real User model ---

/**
 * Middleware to protect routes.
 * It checks for a valid JSON Web Token (JWT) in the
 * Authorization header.
 */
export const authMiddleware = async (req, res, next) => {
  let token;

  // 1. Check for the Authorization header and 'Bearer' token
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // 2. Get token from header
      token = req.headers.authorization.split(' ')[1];

      // 3. Verify the token
      const decoded = jwt.verify(token, env.JWT_SECRET);

      // 4. --- THIS IS THE UPDATED LOGIC ---
      // Find the user by ID from the token payload
      req.user = await User.findById(decoded.id).select('-password').lean();
      // --- END UPDATE ---

      if (!req.user) {
        throw new Error('User not found');
      }

      // 5. Token is valid, proceed
      next();
    } catch (error) {
      logger.error('Authentication failed:', error.message);
      res.status(HTTP_STATUS.UNAUTHORIZED);
      return next(new Error('Not authorized, token failed.'));
    }
  }

  // 1b. If no token is found
  if (!token) {
    res.status(HTTP_STATUS.UNAUTHORIZED);
    return next(new Error('Not authorized, no token.'));
  }
};