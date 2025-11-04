import { getSheetsClient } from '../config/google.js';
import logger from '../config/logger.js';
import ErrorLog from '../models/ErrorLog.js';

/**
 * Appends a single lead's data as a new row to a
 * specified Google Sheet.
 *
 * @param {object} lead - The full Lead document from MongoDB.
 * @param {object} sourceConfig - The config object from the Source model.
 * @param {string} sourceConfig.sheetId - The ID of the Google Sheet.
 * @param {string} sourceConfig.sheetName - The name of the tab (e.g., 'Leads').
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export const appendLeadToSheet = async (lead, sourceConfig) => {
  const { sheetId, sheetName } = sourceConfig;

  // 1. Check if this source is configured for Google Sheets
  if (!sheetId || !sheetName) {
    logger.warn(
      `Google Sheets: Skipping lead ${lead._id}. Source '${lead.siteName}' is not configured with a Sheet ID and Name.`
    );
    // We return true here because it's not a "failure",
    // it's just not configured.
    return true;
  }

  logger.info(
    `Google Sheets: Appending lead ${lead._id} to Sheet ID: ${sheetId}`
  );

  try {
    // 2. Get the authorized Google Sheets API client
    const sheets = await getSheetsClient();

    // 3. Format the lead data into a row (array of values)
    // IMPORTANT: The order here *must* match the column order in your sheet.
    const row = [
      lead.timestampUae.toISOString(), // Use the virtual UAE timestamp
      lead.name || 'N/A',
      lead.phone,
      lead.email || 'N/A',
      lead.source || 'N/A',
      lead.siteName || 'N/A',
      lead.formName || 'N/A',
      lead.campaignName || 'N/A',
      lead.utm?.source || 'N/A',
      lead.utm?.medium || 'N/A',
      lead.utm?.campaign || 'N/A',
      lead.utm?.term || 'N/A',
      lead.utm?.content || 'N/A',
      lead._id.toString(), // Add Lead ID for reference
    ];

    // 4. Append the row to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1`, // Append to the first empty row
      valueInputOption: 'USER_ENTERED', // Interprets data like formulas, dates
      resource: {
        values: [row], // The data must be an array of arrays
      },
    });

    logger.info(`Google Sheets: Successfully appended lead ${lead._id}.`);
    return true;
  } catch (error) {
    logger.error(
      `Google Sheets: FAILED to append lead ${lead._id}. Error: ${error.message}`
    );
    // Log this failure to our ErrorLog collection
    await ErrorLog.create({
      lead: lead._id,
      source: lead.sourceId,
      context: 'SHEETS_JOB',
      message: error.message,
      stack: error.stack,
      payload: { sheetId, sheetName },
    });
    return false;
  }
};