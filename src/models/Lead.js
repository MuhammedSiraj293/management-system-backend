import mongoose from 'mongoose';
import { LEAD_SOURCES, LEAD_STATUSES } from '../utils/constants.js';

const { Schema } = mongoose;

/**
 * This is the central model for all incoming leads.
 * We normalize data from all sources (Elementor, Meta, TikTok)
 * to fit this single, unified structure.
 */
const leadSchema = new Schema(
  {
    // --- Source & Tracking ---
    source: {
      type: String,
      required: [true, 'Lead source is required'],
      enum: {
        values: Object.values(LEAD_SOURCES),
        message: 'Invalid lead source',
      },
    },
    // This connects to our 'Source' model (which we'll make later)
    // It identifies which *specific* website or ad account it came from.
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: 'Source',
      required: [true, 'Lead must have an originating source ID'],
    },
    siteName: {
      type: String,
      trim: true,
      default: 'N/A',
    },
    formName: {
      type: String,
      trim: true,
      default: 'N/A',
    },
    campaignName: {
      type: String,
      trim: true,
      default: 'N/A',
    },
    
    // --- Core Lead Info ---
    name: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },

    // --- UTM & Marketing Data ---
    utm: {
      source: { type: String, trim: true },
      medium: { type: String, trim: true },
      campaign: { type: String, trim: true },
      term: { type: String, trim: true },
      content: { type: String, trim: true },
    },
    
    // --- Timestamps (as per your plan) ---
    // We can use a virtual for the UAE timestamp
    timestampUtc: {
      type: Date,
      default: Date.now,
    },

    // --- Processing Status ---
    status: {
      type: String,
      required: true,
      enum: {
        values: Object.values(LEAD_STATUSES),
        message: 'Invalid lead status',
      },
      default: LEAD_STATUSES.NEW,
    },
    sheetStatus: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED'],
      default: 'PENDING',
    },
    bitrixStatus: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED'],
      default: 'PENDING',
    },
    error: {
      type: String,
      default: null,
    },

    // --- Raw Data ---
    // Store the original, untouched payload from the webhook
    // This is EXTREMELY useful for debugging
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    toJSON: { virtuals: true }, // Ensure virtuals are included in JSON output
    toObject: { virtuals: true },
  }
);

// --- Virtual Property for UAE Timestamp ---
// As per your plan, this creates a 'timestampUae' field dynamically
// by adding 4 hours to the UTC timestamp.
leadSchema.virtual('timestampUae').get(function () {
  if (!this.timestampUtc) { 
    return null;
  }
  const uaeTime = new Date(this.timestampUtc.getTime() + 4 * 60 * 60 * 1000);
  return uaeTime;
});

// --- Indexes for Performance ---
leadSchema.index({ phone: 1, sourceId: 1, createdAt: -1 }); // For duplicate checking
leadSchema.index({ sourceId: 1 });
leadSchema.index({ status: 1, createdAt: -1 }); // For the worker to find jobs
leadSchema.index({ createdAt: -1 }); // For sorting the main lead table

// --- THIS IS THE NEW VALIDATION RULE ---
// This rule runs before any .save() command.
// It will stop the save ONLY if *both* phone and email are missing.
leadSchema.pre('validate', function(next) {
  if (!this.phone && !this.email) {
    // If both are missing, send an error
    next(new Error('A lead must have at least a phone number or an email.'));
  } else {
    // If at least one is present, continue.
    next();
  }
});
// --- END NEW RULE ---


const Lead = mongoose.model('Lead', leadSchema);

export default Lead;