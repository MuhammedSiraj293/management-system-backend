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
 * Handles both array-style and object-style field formats.
 *
 * @param {object} body - The raw req.body from Elementor.
 * @returns {object} Normalized lead data.
 */
const normalizeElementorPayload = (body) => {
  const { form_name, form_fields } = body || {};
  let fields = form_fields || body || {};

  // ✅ Handle case where form_fields is an array (Elementor default)
  if (Array.isArray(fields)) {
    const flat = {};
    for (const field of fields) {
      const key = field?.id || field?.name;
      if (key && field?.value !== undefined) {
        flat[key] = field.value;
      }
    }
    fields = flat;
  }

  let name = null;
  let email = null;
  let phone = null;
  const utm = {};

  const phoneRegex = /^[\+]?[0-9\s\-]{7,15}$/;

  for (const key in fields) {
    const lowerKey = key.toLowerCase();
    const value = String(fields[key]).trim();

    if (!value) continue;

    // Standard fields
    if (lowerKey === "name" && !name) name = value;
    else if (lowerKey === "email" && !email) email = value;
    else if (lowerKey === "phone" && !phone) phone = value;
    // Common Elementor variations
    else if (
      (lowerKey.includes("full_name") || lowerKey.includes("your-name")) &&
      !name
    )
      name = value;
    else if (
      (lowerKey.includes("email") ||
        lowerKey.includes("e-mail") ||
        lowerKey.includes("your-email")) &&
      !email
    )
      email = value;
    else if (
      (lowerKey.includes("phone") ||
        lowerKey.includes("tel") ||
        lowerKey.includes("mobile") ||
        lowerKey.includes("your-phone")) &&
      !phone
    )
      phone = value;
    // Fallback: auto-detect phone numbers
    else if (!phone && value.match(phoneRegex)) phone = value;
    // Capture UTM parameters
    else if (lowerKey.startsWith("utm_"))
      utm[lowerKey.replace("utm_", "")] = value;
  }

  // Fallback for first_name / last_name pattern
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
 * Handles incoming Elementor Pro Form webhooks.
 */
export const handleElementorWebhook = async (req, res) => {
  const source = req.source;
  const body = req.body;

  try {
    // 1️⃣ Normalize the incoming payload
    const normalizedData = normalizeElementorPayload(body);

    // 2️⃣ Validate before saving
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
