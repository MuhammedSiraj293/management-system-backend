import express from 'express';
import { handleElementorWebhook } from '../controllers/webhook/elementorController.js';
import verifyWebhookToken from '../middlewares/verifyWebhookToken.js';
// We will add these as we build them in Phase 2
import { handleMetaWebhook } from '../controllers/webhook/metaController.js';
import { handleTikTokWebhook } from '../controllers/webhook/tiktokController.js';
import { handleSnapchatWebhook } from '../controllers/webhook/snapchatController.js';
// import { metaAuth } from '../middlewares/metaAuth.js';

const router = express.Router();

/**
 * --- Webhook Routes ---
 *
 * These routes are the public-facing endpoints for receiving
 * lead data from third-party platforms.
 */

// -----------------------------------------------------------------
// Phase 1: Elementor
// -----------------------------------------------------------------
// URL: POST /api/webhooks/elementor?token=YOUR_SITE_TOKEN
//
// 1. 'verifyWebhookToken' runs first to check the ?token query.
// 2. If valid, 'handleElementorWebhook' processes the form data.
//
router.post(
  '/elementor',
  verifyWebhookToken, // Middleware to check the token
  handleElementorWebhook // Controller to process the lead
);

// -----------------------------------------------------------------
// Phase 2: Meta (Facebook/Instagram)
// -----------------------------------------------------------------
// --- NEWLY ADDED ---
// URL: POST /api/webhooks/meta?token=YOUR_META_SOURCE_TOKEN
// We re-use verifyWebhookToken for simplicity.
router.post(
  '/meta',
  verifyWebhookToken, // Middleware to check the token
  handleMetaWebhook // Controller to process the lead
);
// GET is for the one-time webhook verification challenge
// router.get('/meta', metaAuth, (req, res) => {
//   console.log('Meta webhook verification challenge received.');
//   res.status(200).send(req.query['hub.challenge']);
// });
//
// POST receives the actual lead data
// router.post('/meta', metaAuth, handleMetaWebhook);

// -----------------------------------------------------------------
// Phase 2: TikTok
// -----------------------------------------------------------------
// router.post('/tiktok', handleTikTokWebhook);
router.post(
  '/tiktok',
  verifyWebhookToken, // Use our simple token auth
  handleTikTokWebhook // Controller to process the lead
);

// -----------------------------------------------------------------
// Phase 2: Snapchat
// -----------------------------------------------------------------
// router.post('/snapchat', handleSnapchatWebhook);
router.post(
  '/snapchat',
  verifyWebhookToken, // Use our simple token auth
  handleSnapchatWebhook // Controller to process the lead
);

export default router;