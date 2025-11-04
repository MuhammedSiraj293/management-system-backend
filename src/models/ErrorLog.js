import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Logs details about failed operations, such as a webhook
 * failing to be processed or a job failing to push to
 * Google Sheets or Bitrix.
 */
const errorLogSchema = new Schema(
  {
    // The lead that this error is related to
    lead: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      default: null, // Some errors might not be lead-specific
    },
    // The source (website/ad account) this error is related to
    source: {
      type: Schema.Types.ObjectId,
      ref: 'Source',
      default: null,
    },
    // Where in the application the error occurred
    // e.g., 'WEBHOOK_PROCESSING', 'SHEETS_JOB', 'BITRIX_JOB'
    context: {
      type: String,
      required: [true, 'Error context is required'],
      trim: true,
    },
    // The error message
    message: {
      type: String,
      required: [true, 'Error message is required'],
    },
    // The full error stack for debugging
    stack: {
      type: String,
      default: null,
    },
    // The raw payload that caused the error, if applicable
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    // Have we tried to resolve this error?
    isResolved: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// --- Indexes ---
// Find errors related to a specific lead
errorLogSchema.index({ lead: 1 });
// Find errors for a specific source
errorLogSchema.index({ source: 1 });
// Quickly find unresolved errors, sorted by newest first
errorLogSchema.index({ isResolved: 1, createdAt: -1 });

const ErrorLog = mongoose.model('ErrorLog', errorLogSchema);

export default ErrorLog;