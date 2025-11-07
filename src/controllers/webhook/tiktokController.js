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
 * Normalizes the incoming payload from a TikTok Lead Ad webhook.
 */
const normalizeTikTokPayload = (body) => {
  const { lead_data } = body;
  const fields = lead_data?.field_list || [];

  let name = null;
  let email = null;
  let phone = null;
  // --- ADDED: New variables ---
  let userType = null;
  let propertyType = null;
  let budget = null;
  let bedrooms = null;
  // --- END ADDED ---

  for (const field of fields) {
    const fieldName = field.field_name?.toLowerCase();
    const fieldValue = field.field_value;

    if (!fieldValue) continue;

    // --- (Name, Email, Phone logic is unchanged) ---
    if (
      (fieldName.includes("name") || fieldName === "full_name") &&
      !name
    ) {
      name = fieldValue;
    } else if (
      (fieldName.includes("email") || fieldName === "email") &&
      !email
    ) {
      email = fieldValue;
    } else if (
      (fieldName.includes("phone") || fieldName.includes("mobile")) &&
      !phone
    ) {
      phone = fieldValue;
    }

    // --- ADDED: Logic to find your new fields ---
    // (These are guesses; adjust fieldName.includes() as needed)
    if (fieldName.includes("user_type") || fieldName.includes("investor"))
      userType = fieldValue;
    
    if (fieldName.includes("property_type") || fieldName.includes("property"))
      propertyType = fieldValue;
    
    if (fieldName.includes("budget"))
      budget = fieldValue;
    
    if (fieldName.includes("bedroom") || fieldName.includes("beds"))
      bedrooms = fieldValue;
    // --- END ADDED ---
  }

  // Fallback if name is split
  if (!name) {
    const firstName = fields.find(f => f.field_name === 'first_name')?.field_value;
    const lastName = fields.find(f => f.field_name === 'last_name')?.field_value;
    if (firstName) {
      name = `${firstName} ${lastName || ''}`.trim();
    }
  }

  // --- ADDED: Return new fields ---
  return {
    name,
    email,
    phone,
    formName: lead_data?.form_name || "N/A",
    campaignName: lead_data?.campaign_name || "N/A",
    adName: lead_data?.ad_name || "N/A",
    adSetName: lead_data?.adset_name || "N/A",
    timestamp: body.lead_data?.create_time,
    userType,
    propertyType,
    budget,
    bedrooms,
  };
};

/**
 * Handle TikTok webhook — respond instantly, process asynchronously.
 * (This function is unchanged)
 */
export const handleTikTokWebhook = async (req, res) => {
  const source = req.source;
  const body = req.body;

  // ✅ Respond immediately
  res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Webhook received successfully.",
  });

  // 🔄 Process the payload asynchronously
  processTikTokLead(source, body).catch((err) => {
    logger.error("Async TikTok processing failed:", err.message);
  });
};

/**
 * Background logic isolated to avoid res.json() reuse
 */
const processTikTokLead = async (source, body) => {
  try {
    // 1️⃣ Normalize the payload
    const normalized = normalizeTikTokPayload(body);

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

    // 3️⃣ Create new lead (NOW INCLUDES NEW FIELDS)
    const newLead = new Lead({
      name: normalized.name,
      email: normalized.email,
      phone: normalized.phone,
      formName: normalized.formName,
      campaignName: normalized.campaignName,
      adName: normalized.adName,
      adSetName: normalized.adSetName,
      
      // --- ADDED ---
      userType: normalized.userType,
      propertyType: normalized.propertyType,
      budget: normalized.budget,
      bedrooms: normalized.bedrooms,
      // --- END ADDED ---

      source: LEAD_SOURCES.TIKTOK,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      payload: body,
      timestampUtc: new Date(normalized.timestamp || Date.now()),
    });

    await newLead.save();

    // 4️⃣ Queue background jobs (Unchanged)
    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: "QUEUED" },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: "QUEUED" },
    ]);

    // 5️⃣ Increment source's lead count (Unchanged)
    await Source.updateOne({ _id: source._id }, { $inc: { leadCount: 1 } });

    logger.info(
      `✅ Lead ${newLead._id} (ID: ${newLead.leadId}) created successfully from TikTok (${source.name}).`
    );
  } catch (error) {
    // 6️⃣ Handle unexpected errors (Unchanged)
    logger.error("❌ Failed to process TikTok webhook:", {
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