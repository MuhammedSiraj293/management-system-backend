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
 */
const normalizeElementorPayload = (body) => {
  if (!body) return {};

  let flatFields = {};
  const formName = body.form_name || body.form?.name || "N/A";

  if (body.fields) {
    for (const key in body.fields) {
      const field = body.fields[key];
      if (field && field.value !== undefined) {
        const newKey =
          field.title?.toLowerCase() ||
          field.id?.toLowerCase() ||
          key.toLowerCase();
        flatFields[newKey] = field.value;
      }
    }
  } else {
    flatFields = body;
  }

  const phoneRegex = /^[\+]?[0-9\s\-]{7,15}$/;
  let name = null,
    email = null,
    phone = null,
    utm = {};

  for (const key in flatFields) {
    const lower = key.toLowerCase();
    const value = String(flatFields[key] ?? "").trim();
    if (!value) continue;

    if ((lower === "name" || lower.includes("full_name")) && !name)
      name = value;
    if (lower === "email" && !email) email = value;
    if (
      (lower === "phone" ||
        lower.includes("tel") ||
        lower.includes("mobile")) &&
      !phone
    )
      phone = value;

    if (!phone && value.match(phoneRegex) && !value.includes("@"))
      phone = value;
    if (lower.startsWith("utm_")) utm[lower.replace("utm_", "")] = value;
  }

  if (!name && (flatFields.first_name || flatFields.last_name)) {
    name = `${flatFields.first_name || ""} ${
      flatFields.last_name || ""
    }`.trim();
  }

  return { name, email, phone, formName, utm };
};

/**
 * Handle Elementor webhook — respond instantly, process asynchronously.
 */
export const handleElementorWebhook = async (req, res) => {
  const source = req.source;
  const body = req.body;

  // ✅ Respond immediately so Elementor never shows "Webhook error"
  res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Webhook received successfully.",
  });

  // 🔄 Process the payload asynchronously (after sending response)
  processElementorLead(source, body).catch((err) => {
    logger.error("Async Elementor processing failed:", err.message);
  });
};

/**
 * Background logic isolated to avoid res.json() reuse
 */
const processElementorLead = async (source, body) => {
  try {
    const normalized = normalizeElementorPayload(body);

    if (!normalized.email && !normalized.phone) {
      const message = "Lead rejected: no phone or email provided.";
      logger.warn(message, { source: source?.name });
      await ErrorLog.create({
        source: source?._id,
        context: "WEBHOOK_PROCESSING",
        message,
        payload: body,
      });
      return;
    }

    const newLead = new Lead({
      name: normalized.name,
      email: normalized.email,
      phone: normalized.phone,
      formName: normalized.formName,
      utm: normalized.utm,
      source: LEAD_SOURCES.ELEMENTOR,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      payload: body,
      timestampUtc: new Date(),
    });

    await newLead.save();

    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: "QUEUED" },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: "QUEUED" },
    ]);

    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    logger.info(
      `✅ Lead ${newLead._id} created successfully from Elementor (${source.name}).`
    );
  } catch (error) {
    logger.error("❌ Failed to process Elementor webhook:", {
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
  }
};
