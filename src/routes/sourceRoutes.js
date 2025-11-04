import express from 'express';
import {
  getAllSources,
  createSource,
  updateSource,
  deleteSource,
} from '../controllers/sourceController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * --- Source Routes ---
 *
 * All routes in this file are protected by the 'authMiddleware'
 * and are prefixed with /api/sources
 */

// Apply auth middleware to all routes in this file
router.use(authMiddleware);

// GET /api/sources
// Fetches all lead sources
router.get('/', getAllSources);

// POST /api/sources
// Creates a new lead source
router.post('/', createSource);

// PUT /api/sources/:sourceId
// Updates an existing lead source
router.put('/:sourceId', updateSource);

// DELETE /api/sources/:sourceId
// Deletes (or deactivates) a lead source
router.delete('/:sourceId', deleteSource);

export default router;