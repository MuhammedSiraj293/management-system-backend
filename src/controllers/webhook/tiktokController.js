import Lead from '../../models/Lead.js';
import Source from '../../models/Source.js';
import ErrorLog from '../../models/ErrorLog.js';
import Job from '../../models/Job.js';
import {
  LEAD_STATUSES,
  LEAD_SOURCES,
  JOB_TYPES,
  HTTP_STATUS,
} from '../../utils/constants.js';
import logger from '../../config/logger.js';

/**
 * Normalizes the incoming payload from a TikTok Lead Ad webhook.
 * TikTok sends data in a 'field_list' array.
 * @param {object} body - The raw req.body from TikTok.
 * @returns {object} A normalized lead data object.
 */
const normalizeTikTokPayload = (body) => {
  const { lead_data } = body;
  const fields = lead_data?.field_list || [];

  let name = null;
  let email = null;
  let phone = null;

  // Loop through the field_list array to find our standard fields
  for (const field of fields) {
    const fieldName = field.field_name?.toLowerCase();
    const fieldValue = field.field_value;

    if (!fieldValue) continue;

    if (
      (fieldName.includes('name') || fieldName === 'full_name') &&
      !name
    ) {
      name = fieldValue;
    } else if (
      (fieldName.includes('email') || fieldName === 'email') &&
      !email
    ) {
      email = fieldValue;
    } else if (
      (fieldName.includes('phone') || fieldName.includes('mobile')) &&
      !phone
    ) {
      phone = fieldValue;
    }
  }

  // Fallback if name is split
  if (!name) {
    const firstName = fields.find(f => f.field_name === 'first_name')?.field_value;
    const lastName = fields.find(f => f.field_name === 'last_name')?.field_value;
    if (firstName) {
      name = `${firstName} ${lastName || ''}`.trim();
    }
  }

  return {
    name,
    email,
    phone,
    formName: lead_data?.form_name || 'N/A',
    campaignName: lead_data?.campaign_name || 'N/A',
    adName: lead_data?.ad_name || 'N/A',
    adSetName: lead_data?.adset_name || 'N/A',
  };
};

/**
 * Handles incoming webhooks from TikTok Lead Ads.
 * Note: TikTok's *real* auth is a complex signature.
 * For our app, we'll re-use our simple token middleware.
 */
export const handleTikTokWebhook = async (req, res) => {
  const source = req.source; // Attached by our verifyWebhookToken middleware
  const body = req.body;

  try {
    // 1. Normalize the payload
    const normalizedData = normalizeTikTokPayload(body);

    // 2. Validate required fields
    if (!normalizedData.phone) {
      logger.warn(
        `TikTok lead rejected: No phone number. Source: ${source.name}`
      );
      await ErrorLog.create({
        source: source._id,
        context: 'WEBHOOK_PROCESSING',
        message: 'Lead rejected: No phone number provided in payload.',
        payload: body,
      });
      // Respond 200 OK so TikTok doesn't retry
      return res
        .status(HTTP_STATUS.OK)
        .json({ success: false, message: 'Lead rejected: no phone.' });
    }

    // 3. Create and save the new lead
    const newLead = new Lead({
      name: normalizedData.name,
      email: normalizedData.email,
      phone: normalizedData.phone,
      formName: normalizedData.formName,
      campaignName: normalizedData.campaignName,
      adName: normalizedData.adName,
      adSetName: normalizedData.adSetName,
      source: LEAD_SOURCES.TIKTOK,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      payload: body,
      timestampUtc: new Date(body.lead_data?.create_time || Date.now()),
    });

    await newLead.save();

    // 4. Create background jobs in MongoDB
    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: 'QUEUED' },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: 'QUEUED' },
    ]);

    // 5. (Optional) Update the lead count
    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    logger.info(`TikTok Lead ${newLead._id} created and queued. Source: ${source.name}`);
    
    // 6. Respond 200 OK (TikTok requires this)
    return res
      .status(HTTP_STATUS.OK) // TikTok specifically requires a 200 OK
      .json({ success: true, message: 'Lead queued successfully.' });
      
  } catch (error) {
    logger.error('Failed to process TikTok webhook:', {
      message: error.message,
      source: source?.name,
      stack: error.stack,
    });
    await ErrorLog.create({
      source: source?._id,
      context: 'WEBHOOK_PROCESSING',
      message: error.message,
      stack: error.stack,
      payload: body,
    });
    // Still send 200 OK so TikTok doesn't spam us with retries
    return res.status(HTTP_STATUS.OK).json({
      success: false,
      message: 'Internal server error, lead ingestion failed.',
    });
  }
};