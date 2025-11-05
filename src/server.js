import app from './app.js';
import env from './config/env.js';
import logger from './config/logger.js';
import connectDB from './config/database.js';
import { seedAdminUser } from './controllers/authController.js';
import cron from 'node-cron'; // --- ADDED ---
import { processNextJob } from './lib/worker.js'; // --- ADDED ---

const PORT = env.PORT || 5001;
let isWorkerRunning = false; // Flag to prevent cron overlap

/**
 * --- CRON JOB (Our new worker) ---
 * We will run the job processor every 30 seconds.
 */
cron.schedule('*/30 * * * * *', async () => {
  if (isWorkerRunning) {
    // Don't start a new job run if the previous one is still going
    return;
  }
  
  isWorkerRunning = true;
  logger.info('CronWorker: Checking for new jobs...');
  try {
    // Keep processing jobs until the queue is empty
    let jobFound = true;
    while (jobFound) {
      jobFound = await processNextJob();
    }
  } catch (error) {
    logger.error('CronWorker: Unhandled error in job processing loop:', error);
  }
  isWorkerRunning = false;
});

/**
 * Starts the Express web server and the cron worker.
 */
const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Seed admin user
    await seedAdminUser();

    // 3. Start listening for HTTP requests
    app.listen(PORT, () => {
      logger.info(`--- Server running in ${env.NODE_ENV} mode ---`);
      logger.info(`API listening on http://localhost:${PORT}`);
      logger.info('Worker cron job started. Will run every 30 seconds.'); // --- ADDED ---
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();