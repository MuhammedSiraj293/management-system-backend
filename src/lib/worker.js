import connectDB from '../config/database.js';
import logger from '../config/logger.js';
import Job from '../models/Job.js';
import Lead from '../models/Lead.js';
import Source from '../models/Source.js';
import { LEAD_STATUSES, JOB_TYPES } from '../utils/constants.js';
import { appendLeadToSheet } from '../integrations/sheets.js';
import { pushLeadToBitrix } from '../integrations/bitrix.js';

const MAX_ATTEMPTS = 3;

/**
 * Finds and processes a single job from the queue.
 * @returns {Promise<boolean>} - True if a job was found, false otherwise.
 */
export const processNextJob = async () => {
  let job;
  try {
    // 1. Find and "lock" the next available job
    job = await Job.findOneAndUpdate(
      {
        status: 'QUEUED',
        runAt: { $lte: new Date() },
      },
      {
        $set: { status: 'PROCESSING' },
        $inc: { attempts: 1 },
      },
      {
        sort: { runAt: 1 },
        new: true,
      }
    ).populate({
      path: 'lead',
      populate: { path: 'sourceId' },
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

    // 4. Update job status
    if (success) {
      await Job.updateOne(
        { _id: job._id },
        { $set: { status: 'COMPLETED' } }
      );
      logger.info(`Job ${job.type} for lead ${lead._id} COMPLETED.`);

      // --- NEW LOGIC ADDED ---
      // After completing a job, check if all jobs for this lead are done
      const pendingJobs = await Job.countDocuments({
        lead: lead._id,
        status: { $in: ['QUEUED', 'PROCESSING'] }, // Are any jobs still running/queued?
      });

      if (pendingJobs === 0) {
        // No jobs are pending. Check if any failed.
        const failedJobs = await Job.countDocuments({
          lead: lead._id,
          status: 'FAILED',
        });

        if (failedJobs === 0) {
          // No jobs pending, none failed. The lead is a SUCCESS.
          logger.info(
            `All jobs for lead ${lead._id} are complete. Marking lead as SUCCESS.`
          );
          await Lead.updateOne(
            { _id: lead._id },
            { $set: { status: LEAD_STATUSES.SUCCESS } }
          );
        }
        // If failedJobs > 0, the retry logic has already
        // set the lead status to FAILED, so we do nothing.
      }
      // --- END NEW LOGIC ---
    } else {
      throw new Error(`Handler for job ${job.type} returned false.`);
    }
    
    return true; // A job was found and processed

  } catch (error) {
    logger.error(`Error processing job ${job?._id}: ${error.message}`);
    if (job) {
      // 5. Handle failures and retries
      const isRetryable = job.attempts < MAX_ATTEMPTS;
      let newStatus = 'FAILED';
      let newRunAt = new Date();

      if (isRetryable) {
        newStatus = 'QUEUED';
        const delay = 5000 * Math.pow(5, job.attempts - 1);
        newRunAt = new Date(Date.now() + delay);
        logger.warn(
          `Job ${job._id} failed. Retrying in ${delay / 1000}s... (Attempt ${
            job.attempts
          })`
        );
      } else {
        logger.error(`Job ${job._id} FAILED permanently after ${MAX_ATTEMPTS} attempts.`);
        // --- THIS IS THE CRITICAL LINE FOR FAILED LEADS ---
        // If a job fails permanently, mark the *parent lead* as FAILED.
        await Lead.updateOne(
          { _id: job.lead._id },
          { $set: { status: LEAD_STATUSES.FAILED } }
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