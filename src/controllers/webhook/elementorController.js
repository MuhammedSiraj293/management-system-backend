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
 * Normalizes the incoming payload from an Elementor form.
 * Handles both array and object styles of `form_fields`.
 *
 * @param {object} body - The raw req.body from Elementor.
 * @returns {object} A normalized lead data object.
 */
const normalizeElementorPayload = (body) => {
  const { form_name, form_fields } = body || {};

  // Elementor can send either:
  // 1. { form_fields: { email: "a@b.com", phone: "123" } }
  // 2. { form_fields: [ { id: "email", value: "a@b.com" }, ... ] }
  // 3. Flat payload (no form_fields key)
  let fields = form_fields || body || {};

  // --- Handle array structure ---
  if (Array.isArray(fields)) {
    const flat = {};
    for (const field of fields) {
      if (field?.id && field?.value !== undefined) {
        flat[field.id] = field.value;
      } else if (field?.name && field?.value !== undefined) {
        flat[field.name] = field.value;
      }
    }
    fields = flat;
  }

  let name = null;
  let email = null;
  let phone = null;
  let utm = {};

  const phoneRegex = /^[\+]?[0-9\s\-]{7,15}$/;

  for (const key in fields) {
    const lowerKey = key.toLowerCase();
    const value = typeof fields[key] === "string" ? fields[key].trim() : "";

    if (!value) continue;

    // Standard fields
    if (lowerKey === "name" && !name) {
      name = value;
    } else if (lowerKey === "email" && !email) {
      email = value;
    } else if (lowerKey === "phone" && !phone) {
      phone = value;
    }

    // Common Elementor variations
    else if (
      (lowerKey.includes("full_name") || lowerKey.includes("your-name")) &&
      !name
    ) {
      name = value;
    } else if (
      (lowerKey.includes("email") ||
        lowerKey.includes("e-mail") ||
        lowerKey.includes("your-email")) &&
      !email
    ) {
      email = value;
    } else if (
      (lowerKey.includes("phone") ||
        lowerKey.includes("tel") ||
        lowerKey.includes("your-phone") ||
        lowerKey.includes("mobile")) &&
      !phone
    ) {
      phone = value;
    }

    // Fallback — auto-detect phone numbers in any random field
    else if (!phone && value.match(phoneRegex)) {
      phone = value;
    }

    // Capture UTM tags
    else if (lowerKey.startsWith("utm_")) {
      utm[lowerKey.replace("utm_", "")] = value;
    }
  }

  // Fallback for first_name / last_name combo
  if (!name && (fields.first_name || fields.last_name)) {
    name = `${fields.first_name || ""} ${fields.last_name || ""}`.trim();
  }

  return {
    name,
    email,
    phone,
    formName: form_name || "N/A",
    utm,
  };
};

/**
 * Handles incoming webhooks from Elementor Pro Forms.
 */
export const handleElementorWebhook = async (req, res) => {
  const source = req.source;
  const body = req.body;

  try {
    // 1. Normalize the payload
    const normalizedData = normalizeElementorPayload(body);

    // 2. Validate before saving
    if (!normalizedData.email && !normalizedData.phone) {
      const message = "Lead rejected: no phone or email provided.";
      logger.warn(message, { source: source?.name });
      await ErrorLog.create({
        source: source?._id,
        context: "WEBHOOK_PROCESSING",
        message,
        payload: body,
      });
      return res.status(HTTP_STATUS.OK).json({
        success: false,
        message,
      });
    }

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

    await newLead.save();

    // 4. Queue jobs
    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: "QUEUED" },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: "QUEUED" },
    ]);

    // 5. Increment lead count
    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    logger.info(`Lead ${newLead._id} created from ${source.name}`);

    return res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: "Lead queued successfully.",
    });
  } catch (error) {
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
