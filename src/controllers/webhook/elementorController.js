import Lead from '../../models/Lead.js';
import Source from '../../models/Source.js';
import ErrorLog from '../../models/ErrorLog.js';
import Job from '../../models/Job.js'; // --- CHANGED: Importing Job model
import {
  LEAD_STATUSES,
  LEAD_SOURCES,
  JOB_TYPES, // --- ADDED: Need job types
  HTTP_STATUS,
} from '../../utils/constants.js';
import logger from '../../config/logger.js'; // --- ADDED: For better logging

/**
 * Normalizes the incoming payload from an Elementor form.
 * (This function is unchanged)
 */
const normalizeElementorPayload = (body) => {
  const { form_fields, form_name } = body || {};
  let name = null,
    email = null,
    phone = null,
    utm = {};
  const fields = form_fields || {};

  for (const key in fields) {
    const lowerKey = key.toLowerCase();
    const value = fields[key];
    if (!value) continue;
    if (lowerKey.includes('name') && !name) name = value;
    else if (lowerKey.includes('email') && !email) email = value;
    else if (
      (lowerKey.includes('phone') ||
        lowerKey.includes('mobile') ||
        lowerKey.includes('whatsapp')) &&
      !phone
    )
      phone = value;
    else if (lowerKey.startsWith('utm_'))
      utm[lowerKey.replace('utm_', '')] = value;
  }
  if (!name && fields.first_name)
    name = `${fields.first_name} ${fields.last_name || ''}`.trim();
  return { name, email, phone, formName: form_name || 'N/A', utm };
};

/**
 * Handles incoming webhooks from Elementor Pro Forms.
 * 1. Authenticates (req.source is attached)
 * 2. Normalizes payload
 * 3. Creates the Lead
 * 4. Creates Jobs in MongoDB
 * 5. Responds immediately.
 */
export const handleElementorWebhook = async (req, res) => {
  const source = req.source; // Attached by our verifyWebhookToken middleware
  const body = req.body;

  try {
    // 1. Normalize the payload
    const normalizedData = normalizeElementorPayload(body);

    // 2. Validate required fields
    if (!normalizedData.phone) {
      logger.warn(
        `Elementor lead rejected: No phone number. Source: ${source.name}`
      );
      await ErrorLog.create({
        source: source._id,
        context: 'WEBHOOK_PROCESSING',
        message: 'Lead rejected: No phone number provided in payload.',
        payload: body,
      });
      // Respond 200 OK so Elementor doesn't retry a bad lead
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
      utm: normalizedData.utm,
      source: LEAD_SOURCES.ELEMENTOR,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED, // Set to 'queued' for the worker
      payload: body,
      timestampUtc: new Date(),
    });

    await newLead.save();

    // 4. --- THIS IS THE NEW LOGIC ---
    // Create background jobs in MongoDB for our worker to find.
    const jobsToCreate = [
      {
        lead: newLead._id,
        type: JOB_TYPES.APPEND_TO_SHEETS,
        status: 'QUEUED',
        runAt: new Date(),
      },
      {
        lead: newLead._id,
        type: JOB_TYPES.PUSH_TO_BITRIX,
        status: 'QUEUED',
        runAt: new Date(), // Run 1 minute later (optional)
        // runAt: new Date(Date.now() + 60 * 1000), 
      },
    ];

    await Job.insertMany(jobsToCreate);

    // 5. (Optional) Update the lead count on the source
    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    // 6. Respond immediately
    logger.info(`Lead ${newLead._id} created and queued. Source: ${source.name}`);
    return res
      .status(HTTP_STATUS.CREATED)
      .json({ success: true, message: 'Lead queued successfully.' });
  } catch (error) {
    logger.error('Failed to process Elementor webhook:', {
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