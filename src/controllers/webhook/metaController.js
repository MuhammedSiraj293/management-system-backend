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
 * Normalizes the incoming payload from a Meta Lead Ad webhook.
 * Meta sends data in a 'field_data' array.
 * @param {object} value - The 'value' object from the webhook.
 * @returns {object} A normalized lead data object.
 */
const normalizeMetaPayload = (value) => {
  const {
    field_data,
    campaign_name,
    form_name,
    ad_name,
    adset_name,
  } = value;

  let name = null;
  let email = null;
  let phone = null;

  // Loop through the field_data array to find our standard fields
  for (const field of field_data) {
    const fieldName = field.name.toLowerCase();
    const fieldValue = field.values[0]; // Get the first value

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
      (fieldName.includes('phone') || fieldName === 'phone_number') &&
      !phone
    ) {
      phone = fieldValue;
    }
  }

  return {
    name,
    email,
    phone,
    formName: form_name || 'N/A',
    campaignName: campaign_name || 'N/A',
    adName: ad_name || 'N/A',
    adSetName: adset_name || 'N/A',
  };
};

/**
 * Handles incoming webhooks from Meta (Facebook) Lead Ads.
 */
export const handleMetaWebhook = async (req, res) => {
  const source = req.source; // Attached by our verifyWebhookToken middleware
  const body = req.body;

  try {
    // Meta webhooks send a complex 'entry' array
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (change?.field !== 'leadgen' || !value) {
      // Not a leadgen update, or no data. Ignore it.
      return res
        .status(HTTP_STATUS.OK)
        .json({ success: true, message: 'Not a leadgen event. Ignored.' });
    }

    // 1. Normalize the payload
    const normalizedData = normalizeMetaPayload(value);

    // 2. Validate required fields
    if (!normalizedData.phone) {
      logger.warn(
        `Meta lead rejected: No phone number. Source: ${source.name}`
      );
      await ErrorLog.create({
        source: source._id,
        context: 'WEBHOOK_PROCESSING',
        message: 'Lead rejected: No phone number provided in payload.',
        payload: body,
      });
      // Respond 200 OK so Meta doesn't retry a bad lead
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
      source: LEAD_SOURCES.META,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      payload: body, // Store the original raw payload
      timestampUtc: new Date(value.created_time * 1000 || Date.now()),
    });

    await newLead.save();

    // 4. Create background jobs in MongoDB
    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: 'QUEUED' },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: 'QUEUED' },
    ]);

    // 5. (Optional) Update the lead count on the source
    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    logger.info(`Meta Lead ${newLead._id} created and queued. Source: ${source.name}`);
    return res
      .status(HTTP_STATUS.CREATED)
      .json({ success: true, message: 'Lead queued successfully.' });
  } catch (error) {
    logger.error('Failed to process Meta webhook:', {
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
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error.',
    });
  }
};