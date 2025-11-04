import express from 'express';
import { getDashboardKpis } from '../controllers/reportController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * --- Report Routes ---
 *
 * All routes in this file are protected by the 'authMiddleware'
 * and are prefixed with /api/reports
 */

// Apply auth middleware to all routes in this file
router.use(authMiddleware);

// GET /api/reports/kpis
// Fetches the main KPI data for the dashboard
router.get('/kpis', getDashboardKpis);

export default router;