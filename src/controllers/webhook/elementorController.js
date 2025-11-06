import Lead from "../../models/Lead.js";
import Source from "../../models/Source.js";
import ErrorLog from "../../models/ErrorLog.js";
import Job from "../../models/Job.js";
import {
  LEAD_STATUSES,
  LEAD_SOURCES,
  JOB_TYPES,
  HTTP_STATUS,
} from "../../utils/constants.js";
import logger from "../../config/logger.js";

/**
 * Normalize Elementor webhook payload
 * THIS IS THE NEW ROBUST VERSION that handles both
 * "Simple" (flat) and "Advanced" (nested) payloads.
 *
 * @param {object} body - The raw req.body from Elementor.
 * @returns {object} Normalized lead data.
 */
const normalizeElementorPayload = (body) => {
  if (!body) return {};

  let flatFields = {};
  let formName = body.form_name || body.form?.name || "N/A";

  if (body.fields) {
    // --- Handle "Advanced" Payload ---
    // (e.g., body.fields.name.value, body.fields.field_5ad7044.value)
    for (const key in body.fields) {
      if (body.fields[key] && body.fields[key].value !== undefined) {
        // Use the field's 'title' (like 'phone') as the key if it exists,
        // otherwise, use the field's 'id' (like 'email' or 'name')
        const field = body.fields[key];
        const newKey = field.title?.toLowerCase() || field.id?.toLowerCase() || key.toLowerCase();
        flatFields[newKey] = field.value;
      }
    }
  } else {
    // --- Handle "Simple" Payload ---
    // (e.g., body.Name, body.Email, body.phone)
    // We just copy the whole body. The loop below will find the right keys.
    flatFields = body;
  }

  // Now, loop through the (now flat) flatFields object to find our data.
  const phoneRegex = /^[\+]?[0-9\s\-]{7,15}$/;
  let name = null, email = null, phone = null, utm = {};

  for (const key in flatFields) {
    const lowerKey = key.toLowerCase();
    const value = String(flatFields[key] ?? "").trim();
    if (!value) continue;

    // Find Name
    if ((lowerKey === 'name' || lowerKey.includes('full_name')) && !name) {
      name = value;
    }
    // Find Email
    if (lowerKey === 'email' && !email) {
      email = value;
    }
    // Find Phone
    if ((lowerKey === 'phone' || lowerKey.includes('tel') || lowerKey.includes('mobile')) && !phone) {
      phone = value;
    }

    // Auto-detect phone in a random field, BUT only if it's not an email
    if (!phone && value.match(phoneRegex) && !value.includes('@')) {
      phone = value;
    }
    
    // Get UTM tags
    if (lowerKey.startsWith("utm_")) {
      utm[lowerKey.replace("utm_", "")] = value;
    }
  }

  // Fallback for first_name/last_name
  if (!name && (flatFields.first_name || flatFields.last_name)) {
    name = `${flatFields.first_name || ''} ${flatFields.last_name || ''}`.trim();
  }

  return {
    name,
    email,
    phone,
    formName: formName, // Use the name we found at the start
    utm,
  };
};


/**
 * Handles incoming Elementor Pro Form webhooks.
 * (This is the same logic you provided, which is great)
 */
export const handleElementorWebhook = async (req, res) => {
  const source = req.source;
  const body = req.body;

  try {
    // 1️⃣ Normalize the incoming payload
    const normalizedData = normalizeElementorPayload(body);

    // 2️⃣ Validate before saving (our controller-level check)
    if (!normalizedData.email && !normalizedData.phone) {
      const message = "Lead rejected: no phone or email provided.";
      logger.warn(message, { source: source?.name });

      await ErrorLog.create({
        source: source?._id,
        context: "WEBHOOK_PROCESSING",
        message,
        payload: body,
      });

      // Respond 200 OK so Elementor doesn't retry a bad lead
      return res.status(HTTP_STATUS.OK).json({
        success: false,
        message,
      });
    }

    // 3️⃣ Create new lead
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

    // This save() will also be protected by the Lead.js model's
    // pre-validate hook, just in case.
    await newLead.save();

    // 4️⃣ Queue background jobs
    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: "QUEUED" },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: "QUEUED" },
    ]);

    // 5️⃣ Increment source's lead count
    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    logger.info(
      `Lead ${newLead._id} created successfully. Source: ${source.name}`
    );

    // 6️⃣ Respond success
    return res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: "Lead queued successfully.",
    });
  } catch (error) {
    // 7️⃣ Handle unexpected errors
    logger.error("Failed to process Elementor webhook:", {
      message: error.message,
      stack: error.stack,
      source: source?.name,
    });

    await ErrorLog.create({
      source: source?._id,
      context: "WEBHOOK_PROCESSING",
      message: error.message,
      stack: error.stack,
      payload: body,
    });

    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error while processing Elementor webhook.",
    });
  }
};