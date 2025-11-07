import express from 'express';
import {
  getAllLeads,
  createLead,
  retryLeadJobs,
} from '../controllers/leadController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js'; // We'll create this soon

const router = express.Router();

/**
 * --- Lead Routes ---
 *
 * All routes in this file are protected by the 'authMiddleware'
 * and are prefixed with /api/leads
 */

// Apply auth middleware to all routes in this file
router.use(authMiddleware);

// GET /api/leads
// Fetches all leads (with pagination, filtering, etc.)
router.get('/', getAllLeads);

// POST /api/leads
// Manually creates a new lead from the admin panel
router.post('/', createLead);

// POST /api/leads/:leadId/retry
// Retries all failed jobs for a specific lead
router.post('/:leadId/retry', retryLeadJobs);

// GET /api/leads/:leadId
// Fetches a single lead by its ID
router.get('/:leadId', getLeadById);

export default router;