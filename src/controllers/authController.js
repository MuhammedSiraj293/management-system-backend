import User from '../models/User.js';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { HTTP_STATUS } from '../utils/constants.js';

/**
 * Generates and sends the token response.
 * @param {object} user - The user model instance.
 * @param {number} statusCode - The HTTP status code.
 * @param {object} res - The Express response object.
 */
const sendTokenResponse = (user, statusCode, res) => {
  // 1. Create the token
  const token = user.getSignedJwtToken();

  // 2. Send response
  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
    },
  });
};

/**
 * @desc    Logs in a user
 * @route   POST /api/auth/login
 * @access  Public
 */
export const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. Validate email & password
    if (!email || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Please provide an email and password',
      });
    }

    // 2. Find user by email
    // We must explicitly .select('+password') because it's hidden by default
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+password'
    );

    // 3. Check if user exists
    if (!user) {
      return res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ success: false, message: 'Invalid credentials' });
    }

    // 4. Check if password matches
    const isMatch = await user.checkPassword(password);

    if (!isMatch) {
      return res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ success: false, message: 'Invalid credentials' });
    }

    // 5. User is valid, send token
    logger.info(`User login successful: ${user.email}`);
    sendTokenResponse(user, HTTP_STATUS.OK, res);
  } catch (error) {
    logger.error('Login error:', error.message);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: 'Server error' });
  }
};

/**
 * @desc    Get current logged in user
 * @route   GET /api/auth/me
 * @access  Private (uses authMiddleware)
 */
export const getMe = async (req, res, next) => {
  // req.user is attached by the authMiddleware
  res.status(HTTP_STATUS.OK).json({
    success: true,
    data: req.user,
  });
};

/**
 * @desc    Utility function to create the initial admin user on startup.
 * This is not a route handler.
 */
export const seedAdminUser = async () => {
  try {
    const adminEmail = env.ADMIN_EMAIL;
    const adminPassword = env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      logger.warn(
        'ADMIN_EMAIL or ADMIN_PASSWORD not set. Skipping admin user seeding.'
      );
      return;
    }

    const userExists = await User.findOne({ email: adminEmail });

    if (!userExists) {
      await User.create({
        name: 'Admin User',
        email: adminEmail,
        password: adminPassword,
        isAdmin: true,
      });
      logger.info(`Admin user created: ${adminEmail}`);
    } else {
      logger.info('Admin user already exists.');
    }
  } catch (error) {
    logger.error('Error seeding admin user:', error.message);
  }
};