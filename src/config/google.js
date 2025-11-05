// backend/src/config/google.js
import { google } from 'googleapis';
import env from './env.js'; // We'll add Google vars to env.js soon
import path from 'path';
import { fileURLToPath } from 'url';

// --- Setup __dirname in ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * --- IMPORTANT ---
 * 1. Create a Google Cloud Project.
 * 2. Enable the "Google Sheets API".
 * 3. Create a "Service Account".
 * 4. Generate a JSON key for it and download it.
 * 5. Save this file as 'service-account.json' in your 'backend/src' folder.
 * 6. !! ADD 'service-account.json' to your .gitignore file !!
 * 7. Share your Google Sheet with the service account's email address.
 */
// Prefer the Render secret file path if it exists, otherwise use local fallback
const SERVICE_ACCOUNT_KEY_FILE =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.resolve(__dirname, '../service-account.json');

// These are the 'permissions' our app is asking for
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let authClient;

/**
 * Initializes the Google Auth client using the service account key.
 * @returns {Promise<JWT>} An authorized Google JWT client.
 */
const getGoogleAuthClient = async () => {
  if (authClient) {
    return authClient;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: SERVICE_ACCOUNT_KEY_FILE,
      scopes: SCOPES,
    });

    authClient = await auth.getClient();
    return authClient;
  } catch (err) {
    console.error(
      'Error loading Google service account credentials:',
      err.message
    );
    console.error(
      'Make sure "service-account.json" is in the "backend/src" folder.'
    );
    // We can't proceed without Google Auth, so we exit.
    // In production, the worker would just log this and retry.
    process.exit(1);
  }
};

/**
 * Creates an authorized Google Sheets API client.
 * @returns {Promise<sheets_v4.Sheets>}
 */
export const getSheetsClient = async () => {
  const auth = await getGoogleAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  return sheets;
};
