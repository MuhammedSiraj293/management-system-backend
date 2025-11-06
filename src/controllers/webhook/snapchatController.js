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
 * Normalizes the incoming payload from a Snapchat Lead Ad webhook.
 */
const normalizeSnapchatPayload = (body) => {
  const lead = body.lead || {};
  const ad = body.ad || {};

  let name =
    lead.full_name ||
    lead.name ||
    `${lead.first_name || ""} ${lead.last_name || ""}`.trim();
  let email = lead.email || null;
  let phone = lead.phone_number || lead.phone || null;

  if (!name) name = "N/A";

  return {
    name,
    email,
    phone,
    formName: ad.form_name || "N/A",
    campaignName: ad.campaign_name || "N/A",
    adName: ad.ad_name || "N/A",
    adSetName: ad.ad_squad_name || "N/A", // Snapchat calls ad sets "squads"
    timestamp: body.lead?.created_at,
  };
};

/**
 * Handle Snapchat webhook — respond instantly, process asynchronously.
 */
export const handleSnapchatWebhook = async (req, res) => {
  const source = req.source;
  const body = req.body;

  // ✅ Respond immediately (200 OK is required by Snapchat)
  res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Webhook received successfully.",
  });

  // 🔄 Process the payload asynchronously (after sending response)
  processSnapchatLead(source, body).catch((err) => {
    logger.error("Async Snapchat processing failed:", err.message);
  });
};

/**
 * Background logic isolated to avoid res.json() reuse
 */
const processSnapchatLead = async (source, body) => {
  try {
    // 1️⃣ Normalize the payload
    const normalized = normalizeSnapchatPayload(body);

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
      source: LEAD_SOURCES.SNAPCHAT,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      payload: body,
      timestampUtc: new Date(normalized.timestamp || Date.now()),
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
      `✅ Lead ${newLead._id} created successfully from Snapchat (${source.name}).`
    );
  } catch (error) {
    // 6️⃣ Handle unexpected errors
    logger.error("❌ Failed to process Snapchat webhook:", {
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
