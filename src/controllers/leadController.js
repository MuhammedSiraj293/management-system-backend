import Lead from '../models/Lead.js';
import Job from '../models/Job.js';
import Source from '../models/Source.js';
import { HTTP_STATUS, LEAD_SOURCES, LEAD_STATUSES, JOB_TYPES } from '../utils/constants.js';
import logger from '../config/logger.js';

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
    if (req.query.sourceId) {
      filters.sourceId = req.query.sourceId;
    }
    if (req.query.status) {
      filters.status = req.query.status;
    }
    if (req.query.phone) {
      // Basic search by phone number
      filters.phone = { $regex: req.query.phone, $options: 'i' };
    }

    // --- Sorting ---
    const sort = {};
    const sortField = req.query.sort || 'createdAt';
    const sortOrder = req.query.order === 'asc' ? 1 : -1;
    sort[sortField] = sortOrder;

    // --- Database Query ---
    const leads = await Lead.find(filters)
      .populate('sourceId', 'name platform') // Populate source info
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
    logger.error('Error fetching leads:', error.message);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: 'Error fetching leads' });
  }
};

/**
 * Manually creates a new lead from the admin dashboard.
 */
export const createLead = async (req, res) => {
  try {
    const { name, phone, email, sourceId } = req.body;

    // 1. Validate input
    if (!phone || !sourceId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Phone number and source ID are required.',
      });
    }

    // 2. Find the source
    const source = await Source.findById(sourceId);
    if (!source) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ success: false, message: 'Source not found.' });
    }

    // 3. Create the new lead
    const newLead = new Lead({
      name,
      phone,
      email,
      source: source.platform, // e.g., 'elementor'
      sourceId: source._id,
      siteName: source.name,
      status: LEAD_STATUSES.QUEUED,
      sourceType: LEAD_SOURCES.MANUAL,
      timestampUtc: new Date(),
    });

    await newLead.save();

    // 4. Create background jobs for the new lead
    await Job.insertMany([
      { lead: newLead._id, type: JOB_TYPES.APPEND_TO_SHEETS, status: 'QUEUED' },
      { lead: newLead._id, type: JOB_TYPES.PUSH_TO_BITRIX, status: 'QUEUED' },
    ]);

    logger.info(`Manually created and queued lead ${newLead._id}`);
    res.status(HTTP_STATUS.CREATED).json({ success: true, data: newLead });
  } catch (error) {
    logger.error('Error manually creating lead:', error.message);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: 'Error creating lead' });
  }
};

/**
 * Retries failed jobs for a specific lead.
 */
export const retryLeadJobs = async (req, res) => {
  try {
    const { leadId } = req.params;
    
    // 1. Find all 'FAILED' jobs for this lead
    const failedJobs = await Job.find({ 
      lead: leadId, 
      status: 'FAILED' 
    });

    if (failedJobs.length === 0) {
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'No failed jobs found for this lead.',
      });
    }

    // 2. Reset the failed jobs back to 'QUEUED'
    const jobIdsToRetry = failedJobs.map(job => job._id);
    
    await Job.updateMany(
      { _id: { $in: jobIdsToRetry } },
      {
        $set: {
          status: 'QUEUED',
          attempts: 0, // Reset attempts
          lastError: null,
          runAt: new Date(), // Run now
        }
      }
    );

    // 3. Update the lead's main status back to 'QUEUED'
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
    logger.error(`Error retrying jobs for lead ${req.params.leadId}:`, error.message);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: 'Error retrying jobs' });
  }
};