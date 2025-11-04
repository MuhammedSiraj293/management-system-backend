/**
 * @fileoverview Centralized constants for the application.
 * This prevents using 'magic strings' in the codebase.
 */

// As per your plan, these are the lead platforms we'll support
export const LEAD_SOURCES = {
  ELEMENTOR: 'elementor',
  META: 'meta',
  TIKTOK: 'tiktok',
  SNAPCHAT: 'snapchat',
  MANUAL: 'manual', // For leads added via the admin dashboard
};

// These are the internal statuses for a lead as it moves
// through the system.
export const LEAD_STATUSES = {
  NEW: 'new', // Just arrived, not yet processed
  QUEUED: 'queued', // Picked up by the controller, sent to the background worker queue
  PROCESSING: 'processing', // Worker has started processing this lead
  SUCCESS: 'success', // All jobs (Sheets, Bitrix) completed successfully
  FAILED: 'failed', // One or more jobs failed and require manual review
  DUPLICATE: 'duplicate', // Identified as a duplicate lead
};

// --- NEWLY ADDED ---
// Internal job types for our MongoDB-based worker
export const JOB_TYPES = {
  APPEND_TO_SHEETS: 'append_to_sheets',
  PUSH_TO_BITRIX: 'push_to_bitrix',
  // We can add more jobs later, like:
  // SEND_WHATSAPP_ALERT: 'send_whatsapp_alert',
};
// --- END NEW ---

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};