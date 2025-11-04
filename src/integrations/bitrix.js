import axios from 'axios';
import { getBitrixApiUrl } from '../config/bitrix.js';
import logger from '../config/logger.js';
import ErrorLog from '../models/ErrorLog.js';

/**
 * Maps our universal Lead model to the Bitrix24 crm.lead.add API format.
 * @param {object} lead - The full Lead document from MongoDB.
 * @param {object} sourceConfig - The config object from the Source model.
 * @returns {object} - The payload ready for the Bitrix API.
 */
const mapLeadToBitrix = (lead, sourceConfig) => {
  // --- Bitrix Field Mapping ---
  // This is a standard mapping. You can customize it as needed.
  const bitrixData = {
    fields: {
      TITLE: `New Lead: ${lead.name || lead.phone}`, // Lead Title
      NAME: lead.name || 'N/A', // First Name
      // LAST_NAME: "", // (Optional) Add if you capture it
      STATUS_ID: 'NEW', // 'NEW' is the default status ID
      OPENED: 'Y', // 'Y' means it's "open"
      ASSIGNED_BY_ID: 1, // (Optional) Assign to a default user (e.g., admin user ID 1)

      // --- Contact Info (Bitrix requires this specific array format) ---
      PHONE: [{ VALUE: lead.phone, VALUE_TYPE: 'WORK' }],
      EMAIL: [{ VALUE: lead.email || '', VALUE_TYPE: 'WORK' }],

      // --- Source & Tracking ---
      SOURCE_ID: 'WEB', // A default source type (e.g., 'WEB', 'ADVERTISING')
      SOURCE_DESCRIPTION: lead.siteName || lead.source, // e.g., "Website #5"
      COMMENTS: `Form: ${lead.formName}\nCampaign: ${lead.campaignName}`,

      // --- UTM Tags ---
      UTM_SOURCE: lead.utm?.source || '',
      UTM_MEDIUM: lead.utm?.medium || '',
      UTM_CAMPAIGN: lead.utm?.campaign || '',
      UTM_TERM: lead.utm?.term || '',
      UTM_CONTENT: lead.utm?.content || '',
    },
    params: {
      REGISTER_SONET_EVENT: 'Y', // Create an event in the activity stream
    },
  };

  // (Optional) If you have a specific pipeline ID for this source
  if (sourceConfig.bitrixPipelineId) {
    // This field might be different based on your Bitrix setup (e.g., 'CATEGORY_ID')
    bitrixData.fields.CATEGORY_ID = sourceConfig.bitrixPipelineId;
  }

  return bitrixData;
};

/**
 * Pushes a single lead to the Bitrix24 CRM.
 *
 * @param {object} lead - The full Lead document from MongoDB.
 * @param {object} sourceConfig - The config object from the Source model.
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export const pushLeadToBitrix = async (lead, sourceConfig) => {
  const apiUrl = getBitrixApiUrl('crm.lead.add');

  // 1. Check if Bitrix is configured
  if (!apiUrl) {
    logger.warn(
      `Bitrix: Skipping lead ${lead._id}. BITRIX_WEBHOOK_URL is not configured.`
    );
    // Return true, as it's not a "failure", just skipped.
    return true;
  }

  logger.info(`Bitrix: Pushing lead ${lead._id} to CRM.`);

  try {
    // 2. Map our lead data to the Bitrix format
    const payload = mapLeadToBitrix(lead, sourceConfig);

    // 3. Make the API call to Bitrix
    const response = await axios.post(apiUrl, payload);

    // 4. Check for a successful Bitrix response
    if (response.data && response.data.result) {
      logger.info(
        `Bitrix: Successfully pushed lead ${lead._id}. Bitrix Lead ID: ${response.data.result}`
      );
      return true;
    } else {
      // Handle cases where Bitrix returns 200 OK but has an API error
      const errorMessage =
        response.data?.error_description || 'Unknown Bitrix API error';
      throw new Error(errorMessage);
    }
  } catch (error) {
    const errorMessage = error.response
      ? JSON.stringify(error.response.data)
      : error.message;
    logger.error(
      `Bitrix: FAILED to push lead ${lead._id}. Error: ${errorMessage}`
    );

    // 5. Log this failure to our ErrorLog collection
    await ErrorLog.create({
      lead: lead._id,
      source: lead.sourceId,
      context: 'BITRIX_JOB',
      message: errorMessage,
      stack: error.stack,
      payload: {
        apiUrl,
        sentData: mapLeadToBitrix(lead, sourceConfig), // Log what we tried to send
      },
    });
    return false;
  }
};