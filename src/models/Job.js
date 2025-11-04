import mongoose from 'mongoose';
import { JOB_TYPES } from '../utils/constants.js'; // We'll add JOB_TYPES to constants.js

const { Schema } = mongoose;

/**
 * Defines the schema for a background job, stored in MongoDB.
 * This allows us to use Mongo as a simple, persistent queue
 * instead of relying on Redis.
 */
const jobSchema = new Schema(
  {
    // The specific lead this job is for
    lead: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
    },
    // The type of job to perform
    type: {
      type: String,
      required: true,
      enum: Object.values(JOB_TYPES),
    },
    // The current status of the job
    status: {
      type: String,
      enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'],
      default: 'QUEUED',
    },
    // Number of times we have attempted to run this job
    attempts: {
      type: Number,
      default: 0,
    },
    // If the job failed, store the last error message
    lastError: {
      type: String,
      default: null,
    },
    // When the job should be processed (allows for delayed jobs)
    runAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// --- Indexes ---
// This is the most important index for the worker.
// It finds queued, non-failed jobs, sorted by when they should run.
jobSchema.index({
  status: 1,
  runAt: 1,
});
// Index to find jobs related to a specific lead
jobSchema.index({ lead: 1 });

const Job = mongoose.model('Job', jobSchema);

export default Job;