import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Setup __dirname in ES Modules ---
// This gets the directory name of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Load .env file ---
// We load the .env file from the *root* of the 'backend' folder
// (one level up from /src, two levels up from /config)
const envPath = path.resolve(__dirname, '../../.env');

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(
    `Warning: Could not find .env file at ${envPath}. Using system environment variables.`
  );
}

// --- Validate and Export Environment Variables ---
const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 5001,

  // --- MongoDB ---
  MONGO_URI:
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lead_system',

  // --- Redis (for BullMQ) ---
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || null,

  // --- Admin User (for frontend login) ---
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@example.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'password123',

  // --- Security ---
  JWT_SECRET: process.env.JWT_SECRET || 'your-super-secret-jwt-key-replace-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
};

// --- (Optional) Strict Validation ---
// In production, we should crash if critical variables are missing
const requiredVars = ['MONGO_URI', 'JWT_SECRET'];
if (env.NODE_ENV === 'production') {
  for (const v of requiredVars) {
    if (!process.env[v]) {
      throw new Error(
        `FATAL ERROR: Environment variable ${v} is not set.`
      );
    }
  }
}

export default env;