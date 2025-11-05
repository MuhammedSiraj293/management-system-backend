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
 * Normalizes the incoming payload from an Elementor form.
 * Elementor forms are custom, so we flexibly check for
 * common field IDs (e.g., 'name', 'email', 'phone').
 * @param {object} body - The raw req.body from Elementor.
 * @returns {object} A normalized lead data object.
 */
const normalizeElementorPayload = (body) => {
  const { form_fields, form_name } = body || {};

  let name = null;
  let email = null;
  let phone = null;
  let utm = {};

  const fields = form_fields || {};

  // Loop through all fields to find our standard ones
  for (const key in fields) {
    const lowerKey = key.toLowerCase();
    const value = fields[key];

    if (!value) continue; // Skip empty fields

    if (lowerKey.includes('name') && !name) {
      name = value;
    } else if (lowerKey.includes('email') && !email) {
      email = value;
    } else if (
      (lowerKey.includes('phone') ||
        lowerKey.includes('mobile') ||
        lowerKey.includes('whatsapp')) &&
      !phone
    ) {
      phone = value;
    } else if (lowerKey.startsWith('utm_')) {
      // e.g., utm_source, utm_medium
      utm[lowerKey.replace('utm_', '')] = value;
    }
  }

  // A common fallback for name fields
  if (!name && fields.first_name) {
    name = `${fields.first_name} ${fields.last_name || ''}`.trim();
  }

  return {
    name,
    email,
    phone,
    formName: form_name || 'N/A',
    utm,
  };
};

/**
 * Handles incoming webhooks from Elementor Pro Forms.
 * 1. Authenticates via middleware (req.source is attached)
 * 2. Normalizes payload
 * 3. Creates the Lead (DB model now handles phone/email validation)
 * 4. Queues background jobs (Sheets, Bitrix)
 * 5. Responds immediately.
 */
export const handleElementorWebhook = async (req, res) => {
  const source = req.source; // Attached by our verifyWebhookToken middleware
  const body = req.body;

  try {
    // 1. Normalize the payload
    const normalizedData = normalizeElementorPayload(body);

    // 2. --- VALIDATION REMOVED ---
    // The old 'if (!normalizedData.phone)' check is gone.
    // The Lead.js model's '.pre('validate')' hook now
    // handles checking for a phone OR an email.

    // 3. Create the new lead
    const newLead = new Lead({
      name: normalizedData.name,
      email: normalizedData.email,
      phone: normalizedData.phone,
      formName: normalizedData.formName,
      utm: normalizedData.utm,
      source: LEAD_SOURCES.ELEMENTOR,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      payload: body,
      timestampUtc: new Date(),
    });

    // 4. Save the lead
    // This will now automatically fail if both
    // email and phone are missing, thanks to our new
    // pre-validate rule in Lead.js
    await newLead.save();

    // 5. Create background jobs in MongoDB
    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: 'QUEUED' },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: 'QUEUED' },
    ]);

    // 6. (Optional) Update the lead count on the source
    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    // 7. Respond immediately
    logger.info(`Lead ${newLead._id} created and queued. Source: ${source.name}`);
    return res
      .status(HTTP_STATUS.CREATED)
      .json({ success: true, message: 'Lead queued successfully.' });

  } catch (error) {
    // --- UPDATED CATCH BLOCK ---
    // This block now catches the validation error from the model.
    logger.error('Failed to process Elementor webhook:', {
      message: error.message,
      source: source?.name,
    });
    
    // Check if it's our specific validation error
    if (error.message.includes('phone or an email')) {
      // Log it, but respond 200 OK so Elementor doesn't retry
      await ErrorLog.create({
        source: source?._id,
        context: 'WEBHOOK_PROCESSING',
        message: 'Lead rejected: No phone or email provided.',
        payload: body,
      });
      return res
        .status(HTTP_STATUS.OK)
        .json({ success: false, message: 'Lead rejected: no phone or email.' });
    }

    // Handle all other types of server errors
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