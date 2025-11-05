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
 * Handles array-style, object-style, and object-of-objects-style formats.
 *
 * @param {object} body - The raw req.body from Elementor.
 * @returns {object} Normalized lead data.
 */
const normalizeElementorPayload = (body) => {
  if (!body) return {};

  let fields = body.form_fields || body.fields || body || {};

  // Handle array-of-objects (default Elementor)
  if (Array.isArray(fields)) {
    const flat = {};
    for (const f of fields) {
      const key = f?.id || f?.name || f?.field_name;
      if (key && f?.value !== undefined) flat[key] = f.value;
    }
    fields = flat;
  }

  // Handle nested structure (like { body: { form_fields: [...] } })
  if (fields.form_fields && Array.isArray(fields.form_fields)) {
    const flat = {};
    for (const f of fields.form_fields) {
      const key = f?.id || f?.name;
      if (key && f?.value !== undefined) flat[key] = f.value;
    }
    fields = flat;
  }

  // --- NEW FIX: Handle object-of-objects ---
  // This checks if the fields object looks like:
  // { name: { id: 'name', value: '...' }, email: { ... } }
  const fieldKeys = Object.keys(fields);
  const firstField = fieldKeys.length > 0 ? fields[fieldKeys[0]] : null;
  
  if (
    firstField &&
    typeof firstField === 'object' &&
    firstField !== null &&
    !Array.isArray(firstField) && // Ensure it's not an array
    firstField.value !== undefined // Check for the .value property
  ) {
    const flat = {};
    for (const key of fieldKeys) {
      // Use 'key' as the new flat key (e.g., 'name', 'email')
      if (fields[key] && fields[key].value !== undefined) {
        flat[key] = fields[key].value;
      }
    }
    // Now, 'fields' is a flat object like { name: 'John', email: '...' }
    fields = flat;
  }
  // --- END NEW FIX ---

  // Now that 'fields' is guaranteed to be a flat object,
  // this loop will work correctly.
  const phoneRegex = /^[\+]?[0-9\s\-]{7,15}$/;
  let name = null, email = null, phone = null, utm = {};

  for (const key in fields) {
    const lower = key.toLowerCase();
    const value = String(fields[key] ?? "").trim();
    if (!value) continue;

    if (lower.includes("name") && !name) name = value;
    if (lower.includes("email") && !email) email = value;
    if ((lower.includes("phone") || lower.includes("tel") || lower.includes("mobile")) && !phone)
      phone = value;
    
    // Check for phone in a random field, BUT only if it's not an email
    if (!phone && value.match(phoneRegex) && !value.includes('@')) phone = value;
    
    if (lower.startsWith("utm_")) utm[lower.replace("utm_", "")] = value;
  }

  return {
    name,
    email,
    phone,
    formName: body.form_name || "N/A",
    utm,
  };
};


/**
 * Handles incoming Elementor Pro Form webhooks.
 * (This part is the same as your code)
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