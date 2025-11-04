import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { LEAD_SOURCES } from '../utils/constants.js';

const { Schema } = mongoose;

/**
 * Stores information about each unique lead source, such as
 * a specific WordPress site, a Meta Ad Account, or a TikTok App.
 *
 * This allows us to track leads back to their exact origin and
 * store credentials (like API tokens) securely.
 */
const sourceSchema = new Schema(
  {
    // Friendly name for the UI, e.g., "Main Property Site (WP)"
    name: {
      type: String,
      required: [true, 'Source name is required'],
      trim: true,
      unique: true,
    },
    // The type of platform this source is
    platform: {
      type: String,
      required: [true, 'Platform type is required'],
      enum: {
        values: Object.values(LEAD_SOURCES),
        message: 'Invalid source platform',
      },
    },
    // The unique token to identify this source.
    // For Elementor, this will be in the webhook URL.
    // e.g., /api/webhooks/elementor?token=...
    // For Meta/TikTok, this could be the App ID or Page ID.
    identifierToken: {
      type: String,
      required: [true, 'Identifier token is required'],
      unique: true,
      default: () => uuidv4(), // Auto-generate a unique token by default
    },
    // Is this source currently active and accepting leads?
    isActive: {
      type: Boolean,
      default: true,
    },
    // Store associated credentials, e.g., Google Sheet ID for this source
    // or Bitrix pipeline ID.
    config: {
      sheetId: { type: String, trim: true, default: null },
      sheetName: { type: String, trim: true, default: 'Leads' },
      bitrixPipelineId: { type: String, trim: true, default: null },
    },
    // Simple counter for leads from this source
    leadCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// --- Indexes ---
// Fast lookup by the token in the webhook URL
// sourceSchema.index({ identifierToken: 1 });
// For the frontend UI to list sources by platform
// sourceSchema.index({ platform: 1 });

const Source = mongoose.model('Source', sourceSchema);

export default Source;