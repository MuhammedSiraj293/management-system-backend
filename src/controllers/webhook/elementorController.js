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
 * THIS IS THE NEW, MORE ROBUST VERSION.
 *
 * @param {object} body - The raw req.body from Elementor.
 * @returns {object} A normalized lead data object.
 */
const normalizeElementorPayload = (body) => {
  const { form_name, form_fields } = body || {};

  // --- THIS IS THE FIX ---
  // We check for the 'form_fields' object first.
  // If it doesn't exist, we fall back to using the entire 'body'.
  // This handles both of Elementor's payload structures.
  const fields = form_fields || body || {};

  let name = null;
  let email = null;
  let phone = null;
  let utm = {};

  // This regex will match 7-15 digit phone numbers,
  // allowing spaces, +, and hyphens.
  const phoneRegex = /^[\+]?[0-9\s\-]{7,15}$/;

  for (const key in fields) {
    const lowerKey = key.toLowerCase();
    const value = fields[key];

    if (!value || typeof value !== "string") continue; // Skip empty or non-string values

    // 1. Check for standard, named fields
    if (lowerKey === "name" && !name) {
      name = value;
    } else if (lowerKey === "email" && !email) {
      email = value;
    } else if (lowerKey === "phone" && !phone) {
      phone = value;
    }
    // 2. Check for common variations
    else if (lowerKey.includes("full_name") && !name) {
      name = value;
    } else if (lowerKey.includes("phone_number") && !phone) {
      phone = value;
    }
    // 3. Auto-detect phone in a random field (like 'field_48f580e')
    else if (!phone && value.match(phoneRegex)) {
      // If we don't have a phone yet, and the field's *value*
      // looks like a phone number, use it.
      phone = value;
    }
    // 4. Capture UTM tags
    else if (lowerKey.startsWith("utm_")) {
      utm[lowerKey.replace("utm_", "")] = value;
    }
  }

  // A common fallback for 'first_name' / 'last_name' fields
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
 * (This logic is the same as the last step)
 */
export const handleElementorWebhook = async (req, res) => {
  const source = req.source;
  const body = req.body;

  try {
    // 1. Normalize the payload (using our new function)
    const normalizedData = normalizeElementorPayload(body);

    // 2. Create the new lead
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
      payload: body, // Store the original raw payload
      timestampUtc: new Date(),
    });

    // 3. Save the lead (This will fail if both email/phone are null)
    await newLead.save();

    // 4. Create background jobs
    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: "QUEUED" },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: "QUEUED" },
    ]);

    // 5. Update the lead count
    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    // 6. Respond
    logger.info(
      `Lead ${newLead._id} created and queued. Source: ${source.name}`
    );
    return res
      .status(HTTP_STATUS.CREATED)
      .json({ success: true, message: "Lead queued successfully." });
  } catch (error) {
    // 7. Handle errors (including our validation error)
    logger.error("Failed to process Elementor webhook:", {
      message: error.message,
      source: source?.name,
    });

    // Check if it's our validation error
    if (error.message.includes("phone or an email")) {
      await ErrorLog.create({
        source: source?._id,
        context: "WEBHOOK_PROCESSING",
        message: "Lead rejected: No phone or email provided.",
        payload: body,
      });
      return res
        .status(HTTP_STATUS.OK)
        .json({ success: false, message: "Lead rejected: no phone or email." });
    }

    // Handle other server errors
    await ErrorLog.create({
      source: source?._id,
      context: "WEBHOOK_PROCESSING",
      message: error.message,
      stack: error.stack,
      payload: body,
    });
    // Respond with 500 so Elementor logs the error
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error.",
    });
  }
};
