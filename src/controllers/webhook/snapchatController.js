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
 * Normalizes the incoming payload from a Snapchat Lead Ad webhook.
 * Snapchat sends data in a 'lead' object with key-value pairs.
 * @param {object} body - The raw req.body from Snapchat.
 * @returns {object} A normalized lead data object.
 */
const normalizeSnapchatPayload = (body) => {
  const lead = body.lead || {};
  const ad = body.ad || {};

  // Snapchat fields are often just keys, like "full_name" or "email"
  // We'll normalize common variations.
  let name =
    lead.full_name ||
    lead.name ||
    `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
  let email = lead.email || null;
  let phone = lead.phone_number || lead.phone || null;

  // If name is still empty, default to 'N/A'
  if (!name) name = 'N/A';
  
  return {
    name,
    email,
    phone,
    formName: ad.form_name || 'N/A',
    campaignName: ad.campaign_name || 'N/A',
    adName: ad.ad_name || 'N/A',
    adSetName: ad.ad_squad_name || 'N/A', // Snapchat calls ad sets "squads"
  };
};

/**
 * Handles incoming webhooks from Snapchat Lead Ads.
 */
export const handleSnapchatWebhook = async (req, res) => {
  const source = req.source; // Attached by our verifyWebhookToken middleware
  const body = req.body;

  try {
    // 1. Normalize the payload
    const normalizedData = normalizeSnapchatPayload(body);

    // 2. Validate required fields
    if (!normalizedData.phone) {
      logger.warn(
        `Snapchat lead rejected: No phone number. Source: ${source.name}`
      );
      await ErrorLog.create({
        source: source._id,
        context: 'WEBHOOK_PROCESSING',
        message: 'Lead rejected: No phone number provided in payload.',
        payload: body,
      });
      // Respond 200 OK so Snapchat doesn't retry
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
      source: LEAD_SOURCES.SNAPCHAT,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      payload: body,
      timestampUtc: new Date(body.lead?.created_at || Date.now()),
    });

    await newLead.save();

    // 4. Create background jobs in MongoDB
    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: 'QUEUED' },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: 'QUEUED' },
    ]);

    // 5. (Optional) Update the lead count
    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    logger.info(`Snapchat Lead ${newLead._id} created and queued. Source: ${source.name}`);
    
    // 6. Respond 200 OK
    return res
      .status(HTTP_STATUS.OK)
      .json({ success: true, message: 'Lead queued successfully.' });

  } catch (error) {
    logger.error('Failed to process Snapchat webhook:', {
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
    // Still send 200 OK
    return res.status(HTTP_STATUS.OK).json({
      success: false,
      message: 'Internal server error, lead ingestion failed.',
    });
  }
};