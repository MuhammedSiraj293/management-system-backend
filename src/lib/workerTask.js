// backend/src/lib/workerTask.j
import connectDB from '../config/database.js';
import logger from '../config/logger.js';
import Job from '../models/Job.js';
import Lead from '../models/Lead.js';
import Source from '../models/Source.js';
import { LEAD_STATUSES, JOB_TYPES } from '../utils/constants.js';
import { appendLeadToSheet } from '../integrations/sheets.js';
import { pushLeadToBitrix } from '../integrations/bitrix.js';

const POLLING_INTERVAL_MS = 5000; // Poll for new jobs every 5 seconds
const MAX_ATTEMPTS = 3; // Max times to retry a failed job

/**
 * A simple utility function to pause execution.
 * @param {number} ms - Milliseconds to wait.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Finds and processes a single job from the queue.
 * It locks the job by setting its status to 'PROCESSING'.
 * @returns {Promise<boolean>} - True if a job was found and processed, false otherwise.
 */
const processNextJob = async () => {
  let job;
  try {
    // 1. Find and "lock" the next available job atomically
    // We find a QUEUED job, sort by when it should run,
    // and immediately update its status to PROCESSING.
    job = await Job.findOneAndUpdate(
      {
        status: 'QUEUED',
        runAt: { $lte: new Date() }, // Find jobs that are ready to run
      },
      {
        $set: { status: 'PROCESSING' },
        $inc: { attempts: 1 }, // Increment attempt counter
      },
      {
        sort: { runAt: 1 }, // Process oldest jobs first
        new: true, // Return the *updated* document
      }
    ).populate({
      path: 'lead',
      populate: { path: 'sourceId' }, // Populate the source *within* the lead
    });

    // 2. If no job was found, we're done.
    if (!job) {
      return false; // No job found
    }

    const lead = job.lead;
    if (!lead || !lead.sourceId) {
      throw new Error(`Job ${job._id} is missing lead or source data.`);
    }

    const sourceConfig = lead.sourceId.config;
    logger.info(`Processing job ${job.type} for lead ${lead._id}...`);

    // 3. --- Job-Handler Logic ---
    let success = false;
    if (job.type === JOB_TYPES.APPEND_TO_SHEETS) {
      success = await appendLeadToSheet(lead, sourceConfig);
      await Lead.updateOne(
        { _id: lead._id },
        { sheetStatus: success ? 'SUCCESS' : 'FAILED' }
      );
    } else if (job.type === JOB_TYPES.PUSH_TO_BITRIX) {
      success = await pushLeadToBitrix(lead, sourceConfig);
      await Lead.updateOne(
        { _id: lead._id },
        { bitrixStatus: success ? 'SUCCESS' : 'FAILED' }
      );
    }

    // 4. Update job status based on success
    if (success) {
      await Job.updateOne(
        { _id: job._id },
        { $set: { status: 'COMPLETED' } }
      );
      logger.info(`Job ${job.type} for lead ${lead._id} COMPLETED.`);
    } else {
      throw new Error(`Handler for job ${job.type} returned false.`);
    }
    
    // We found and processed a job
    return true;

  } catch (error) {
    logger.error(`Error processing job ${job?._id}: ${error.message}`);
    if (job) {
      // 5. Handle failures and retries
      const isRetryable = job.attempts < MAX_ATTEMPTS;
      let newStatus = 'FAILED'; // Default to FAILED
      let newRunAt = new Date();

      if (isRetryable) {
        // If we can retry, set back to QUEUED with a delay
        newStatus = 'QUEUED';
        // Exponential backoff: 5s, 25s, 125s
        const delay = 5000 * Math.pow(5, job.attempts - 1);
        newRunAt = new Date(Date.now() + delay);
        logger.warn(
          `Job ${job._id} failed. Retrying in ${delay / 1000}s... (Attempt ${
            job.attempts
          })`
        );
      } else {
        logger.error(`Job ${job._id} FAILED permanently after ${MAX_ATTEMPTS} attempts.`);
        // Mark the lead as failed too
        await Lead.updateOne(
          { _id: job.lead._id },
          { status: LEAD_STATUSES.FAILED }
        );
      }

      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status: newStatus,
            lastError: error.message,
            runAt: newRunAt,
          },
        }
      );
    }
    return false; // Job processing failed
  }
};

/**
 * The main worker loop.
 * Connects to the DB, then polls for jobs indefinitely.
 */
const startWorker = async () => {
  logger.info('--- Background Worker starting... ---');
  await connectDB();
  logger.info('Worker connected to MongoDB.');

  while (true) {
    try {
      const jobProcessed = await processNextJob();
      
      // If no job was found, wait before polling again
      if (!jobProcessed) {
        await sleep(POLLING_INTERVAL_MS);
      }
      // If a job *was* processed, immediately check for another one
      // This allows the queue to drain quickly
    } catch (error) {
      logger.error('Unhandled error in worker loop:', error);
      // Wait before trying again to prevent crash loops
      await sleep(POLLING_INTERVAL_MS);
    }
  }
};

// Start the worker
startWorker();