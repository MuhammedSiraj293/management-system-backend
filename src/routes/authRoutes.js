import express from 'express';
import { loginUser, getMe } from '../controllers/authController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * --- Auth Routes ---
 *
 * All routes are prefixed with /api/auth
 */

// POST /api/auth/login
// Logs in a user and returns a token
router.post('/login', loginUser);

// GET /api/auth/me
// Gets the currently logged-in user (protected)
router.get('/me', authMiddleware, getMe);

export default router;