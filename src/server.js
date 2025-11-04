import app from './app.js';
import env from './config/env.js';
import logger from './config/logger.js';
import connectDB from './config/database.js';
import { seedAdminUser } from './controllers/authController.js'; // --- ADDED ---

const PORT = env.PORT || 5001;

/**
 * Starts the Express web server.
 */
const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. --- ADDED: Seed admin user ---
    // This will create the admin user if one doesn't exist
    await seedAdminUser();

    // 3. Start listening for HTTP requests
    app.listen(PORT, () => {
      logger.info(`--- Server running in ${env.NODE_ENV} mode ---`);
      logger.info(`API listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();