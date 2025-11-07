import { getSheetsClient } from '../config/google.js';
import logger from '../config/logger.js';
import ErrorLog from '../models/ErrorLog.js';

/**
 * --- THIS IS THE NEW HEADER ROW ---
 * The order of these titles MUST match the order of the
 * 'row' variable below.
 */
const HEADER_ROW = [
  "Date",
  "Lead ID",
  "Name",
  "Phone",
  "Email",
  "User Type",
  "Property Type",
  "Budget",
  "Bedrooms",
  "Platform",
  "Source Name",
  "Form Name",
  "Campaign",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "Internal Mongo ID"
];

/**
 * Appends a single lead's data as a new row to a
 * specified Google Sheet.
 */
export const appendLeadToSheet = async (lead, sourceConfig) => {
  const { sheetId, sheetName } = sourceConfig;

  if (!sheetId || !sheetName) {
    logger.warn(
      `Google Sheets: Skipping lead ${lead._id}. Source '${lead.siteName}' is not configured.`
    );
    return true;
  }

  logger.info(
    `Google Sheets: Appending lead ${lead.leadId || lead._id} to Sheet ID: ${sheetId}`
  );

  try {
    const sheets = await getSheetsClient();

    // --- NEW LOGIC: Check for header row ---
    // 1. Check if cell A1 in the specified sheet (tab) is empty.
    const headerCheck = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:A1`, // Check only the very first cell
    });

    // 2. If the 'values' array is missing, the sheet is empty.
    const headerExists = headerCheck.data.values && headerCheck.data.values.length > 0;

    if (!headerExists) {
      // 3. If no header, append our HEADER_ROW first.
      logger.info(`Google Sheets: No header found in '${sheetName}'. Creating one...`);
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${sheetName}!A1`, // Start at A1
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [HEADER_ROW], // Note the double array
        },
      });
    }
    // --- END NEW LOGIC ---


    // 4. Format the lead data row (this order must match HEADER_ROW)
    const row = [
      lead.timestampUae.toISOString(),
      lead.leadId ? `LEAD#${lead.leadId}` : 'N/A',
      lead.name || 'N/A',
      lead.phone || 'N/A',
      lead.email || 'N/A',
      lead.userType || 'N/A',
      lead.propertyType || 'N/A',
      lead.budget || 'N/A',
      lead.bedrooms || 'N/A',
      lead.source || 'N/A',
      lead.siteName || 'N/A',
      lead.formName || 'N/A',
      lead.campaignName || 'N/A',
      lead.utm?.source || 'N/A',
      lead.utm?.medium || 'N/A',
      lead.utm?.campaign || 'N/A',
      lead.utm?.term || 'N/A',
      lead.utm?.content || 'N/A',
      lead._id.toString(),
    ];

    // 5. Append the actual lead data row
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1`, // Append to the first empty row (after header)
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [row],
      },
    });

    logger.info(`Google Sheets: Successfully appended lead ${lead.leadId || lead._id}.`);
    return true;
  } catch (error) {
    logger.error(
      `Google Sheets: FAILED to append lead ${lead.leadId || lead._id}. Error: ${error.message}`
    );
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