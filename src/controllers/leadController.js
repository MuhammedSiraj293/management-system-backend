import Lead from "../models/Lead.js";
import Job from "../models/Job.js";
import Source from "../models/Source.js";
import { HTTP_STATUS, LEAD_STATUSES, JOB_TYPES } from "../utils/constants.js";
import logger from "../config/logger.js";
import { isValid, parseISO } from "date-fns"; // We'll need to install date-fns

/**
 * --- Helper Function to calculate date ranges ---
 */
const getDateRangeFilter = (queryParams) => {
  const { dateRange, dateFrom, dateTo } = queryParams;
  const createdAtFilter = {};

  if (dateRange && dateRange !== "all" && dateRange !== "custom") {
    // --- Handle preset ranges (24h, 7d, 14d, 28d) ---
    const now = new Date();
    let daysToSubtract = 0;

    if (dateRange === "24h") {
      daysToSubtract = 1;
    } else if (dateRange === "7d") {
      daysToSubtract = 7;
    } else if (dateRange === "14d") {
      daysToSubtract = 14;
    } else if (dateRange === "28d") {
      daysToSubtract = 28;
    }

    if (daysToSubtract > 0) {
      createdAtFilter.$gte = new Date(
        now.setDate(now.getDate() - daysToSubtract)
      );
    }
  } else if (dateRange === "custom") {
    // --- Handle custom date range ---
    if (dateFrom && isValid(parseISO(dateFrom))) {
      // Set to the start of the day
      createdAtFilter.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
    }
    if (dateTo && isValid(parseISO(dateTo))) {
      // Set to the end of the day
      createdAtFilter.$lte = new Date(`${dateTo}T23:59:59.999Z`);
    }
  }

  // Return the filter if it has keys, otherwise return null
  return Object.keys(createdAtFilter).length > 0 ? createdAtFilter : null;
};

/**
 * Fetches all leads with pagination, filtering, and sorting.
 * This is the main endpoint for the 'Leads' page on the frontend.
 */
export const getAllLeads = async (req, res) => {
  try {
    // --- Pagination ---
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    // --- Filtering ---
    const filters = {};

    // 1. Filter by Source ID (from dropdown)
    if (req.query.sourceId) {
      filters.sourceId = req.query.sourceId;
    }

    // 2. Filter by Status (from dropdown)
    if (req.query.status) {
      filters.status = req.query.status;
    }

    // 3. Filter by Date Range
    const dateFilter = getDateRangeFilter(req.query);
    if (dateFilter) {
      filters.createdAt = dateFilter;
    }

    // 4. (Future) Filter by Search Term (phone, email, name)
    if (req.query.search) {
      const searchRegex = { $regex: req.query.search, $options: "i" };
      filters.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ];
    }

    // --- Sorting ---
    const sort = {};
    const sortField = req.query.sort || "createdAt";
    const sortOrder = req.query.order === "asc" ? 1 : -1;
    sort[sortField] = sortOrder;

    // --- Database Query ---
    const leads = await Lead.find(filters)
      .populate("sourceId", "name platform") // Populate source info
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(); // Use .lean() for faster read-only queries

    const totalLeads = await Lead.countDocuments(filters);
    const totalPages = Math.ceil(totalLeads / limit);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: leads,
      pagination: {
        totalLeads,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (error) {
    logger.error("Error fetching leads:", error.message);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "Error fetching leads" });
  }
};

// --- NEW FUNCTION ADDED ---
/**
 * Fetches a single lead by its ID.
 * This will also populate related jobs and errors.
 */
export const getLeadById = async (req, res) => {
  try {
    const { leadId } = req.params;

    const lead = await Lead.findById(leadId)
      .populate('sourceId', 'name platform')
      .lean();

    if (!lead) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ success: false, message: 'Lead not found' });
    }

    // Find all related jobs and errors
    const jobs = await Job.find({ lead: leadId }).sort({ createdAt: -1 }).lean();
    const errors = await ErrorLog.find({ lead: leadId }).sort({ createdAt: -1 }).lean();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        lead,
        jobs,
        errors,
      },
    });
  } catch (error) {
    logger.error(`Error fetching lead by ID ${req.params.leadId}:`, error.message);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: 'Error fetching lead details' });
  }
};
// --- END NEW FUNCTION ---
/**
 * Manually creates a new lead from the admin dashboard.
 * (This controller is unchanged)
 */
export const createLead = async (req, res) => {
  try {
    const { name, phone, email, sourceId } = req.body;
    if (!phone && !email) {
      // Use our new validation
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: "Phone number or email is required.",
      });
    }
    if (!sourceId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: "Source ID is required.",
      });
    }

    const source = await Source.findById(sourceId);
    if (!source) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ success: false, message: "Source not found." });
    }

    const newLead = new Lead({
      name,
      phone,
      email,
      source: source.platform,
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      sourceType: LEAD_SOURCES.MANUAL,
      timestampUtc: new Date(),
    });

    await newLead.save();

    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: "QUEUED" },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: "QUEUED" },
    ]);

    logger.info(`Manually created and queued lead ${newLead._id}`);
    res.status(HTTP_STATUS.CREATED).json({ success: true, data: newLead });
  } catch (error) {
    logger.error("Error manually creating lead:", error.message);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "Error creating lead" });
  }
};

/**
 * Retries failed jobs for a specific lead.
 * (This controller is unchanged)
 */
export const retryLeadJobs = async (req, res) => {
  try {
    const { leadId } = req.params;

    const failedJobs = await Job.find({
      lead: leadId,
      status: "FAILED",
    });

    if (failedJobs.length === 0) {
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: "No failed jobs found for this lead.",
      });
    }

    const jobIdsToRetry = failedJobs.map((job) => job._id);

    await Job.updateMany(
      { _id: { $in: jobIdsToRetry } },
      {
        $set: {
          status: "QUEUED",
          attempts: 0,
          lastError: null,
          runAt: new Date(),
        },
      }
    );

    await Lead.updateOne(
      { _id: leadId },
      { $set: { status: LEAD_STATUSES.QUEUED } }
    );

    logger.info(`Retrying ${failedJobs.length} jobs for lead ${leadId}`);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `Successfully queued ${failedJobs.length} jobs for retry.`,
    });
  } catch (error) {
    logger.error(
      `Error retrying jobs for lead ${req.params.leadId}:`,
      error.message
    );
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "Error retrying jobs" });
  }
};
