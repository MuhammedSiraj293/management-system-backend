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
 * Normalizes the incoming payload from a Meta Lead Ad webhook.
 */
const normalizeMetaPayload = (value) => {
  const { field_data, campaign_name, form_name, ad_name, adset_name } = value;

  let name = null;
  let email = null;
  let phone = null;

  for (const field of field_data) {
    const fieldName = field.name.toLowerCase();
    const fieldValue = field.values[0];

    if (!fieldValue) continue;

    if ((fieldName.includes("name") || fieldName === "full_name") && !name) {
      name = fieldValue;
    } else if (
      (fieldName.includes("email") || fieldName === "email") &&
      !email
    ) {
      email = fieldValue;
    } else if (
      (fieldName.includes("phone") || fieldName === "phone_number") &&
      !phone
    ) {
      // Clean the phone number by removing spaces, +, -
      phone = fieldValue.replace(/[\s\+\-]/g, "");
    }
  }

  return {
    name,
    email,
    phone,
    formName: form_name || "N/A",
    campaignName: campaign_name || "N/A",
    adName: ad_name || "N/A",
    adSetName: adset_name || "N/A",
  };
};

/**
 * Handle Meta webhook — respond instantly, process asynchronously.
 */
export const handleMetaWebhook = async (req, res) => {
  const source = req.source;
  const body = req.body;

  // ✅ Respond immediately (200 OK is required by Meta)
  res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Webhook received successfully.",
  });

  // 🔄 Process the payload asynchronously (after sending response)
  processMetaLead(source, body).catch((err) => {
    logger.error("Async Meta processing failed:", err.message);
  });
};

/**
 * Background logic isolated to avoid res.json() reuse
 */
const processMetaLead = async (source, body) => {
  try {
    // Meta webhooks send a complex 'entry' array
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (change?.field !== "leadgen" || !value) {
      // Not a leadgen update, or no data. Ignore it.
      logger.info("Meta webhook received, but not a leadgen event. Ignored.");
      return;
    }

    // 1️⃣ Normalize the payload
    const normalized = normalizeMetaPayload(value);

    // 2️⃣ Validate before saving
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

    // 3️⃣ Create new lead
    const newLead = new Lead({
      name: normalized.name,
      email: normalized.email,
      phone: normalized.phone,
      formName: normalized.formName,
      campaignName: normalized.campaignName,
      adName: normalized.adName,
      adSetName: normalized.adSetName,
      source: LEAD_SOURCES.META,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      payload: body,
      timestampUtc: new Date(value.created_time * 1000 || Date.now()),
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
      `✅ Lead ${newLead._id} created successfully from Meta (${source.name}).`
    );
  } catch (error) {
    // 6️⃣ Handle unexpected errors
    logger.error("❌ Failed to process Meta webhook:", {
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
