import mongoose from 'mongoose';
import env from './env.js';
import logger from './logger.js'; // We'll create this next

/**
 * Handles the connection to the MongoDB database using Mongoose.
 */
const connectDB = async () => {
  try {
    // Mongoose 6+ no longer needs the useNewUrlParser, useUnifiedTopology, etc.
    await mongoose.connect(env.MONGO_URI);
    logger.info('MongoDB connected successfully.');
  } catch (err) {
    logger.error('MongoDB connection error:', err);
    // Exit process with failure
    process.exit(1);
  }
};

export default connectDB;