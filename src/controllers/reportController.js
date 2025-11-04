import Lead from '../models/Lead.js';
import Job from '../models/Job.js';
import { HTTP_STATUS, LEAD_STATUSES } from '../utils/constants.js';
import logger from '../config/logger.js';

/**
 * Fetches the main Key Performance Indicators (KPIs)
 * for the dashboard.
 */
export const getDashboardKpis = async (req, res) => {
  try {
    // 1. Define time ranges
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 2. Run queries in parallel
    const [
      leadsTodayCount,
      leads24hCount,
      failedJobsCount,
      leadsBySource,
    ] = await Promise.all([
      // Count leads created since the start of today
      Lead.countDocuments({ createdAt: { $gte: todayStart } }),
      
      // Count leads created in the last 24 hours
      Lead.countDocuments({ createdAt: { $gte: twentyFourHoursAgo } }),
      
      // Count jobs (not leads) that are permanently failed
      Job.countDocuments({ status: 'FAILED' }),

      // Aggregate leads by their source name
      Lead.aggregate([
        {
          $group: {
            _id: '$siteName', // Group by the 'siteName' field
            count: { $sum: 1 },
          },
        },
        {
          $sort: { count: -1 }, // Sort by most leads
        },
      ]),
    ]);

    // 3. Format the response
    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        leadsToday: leadsTodayCount,
        leadsLast24h: leads24hCount,
        failedJobs: failedJobsCount,
        leadsBySource: leadsBySource, // This will be an array like [{ _id: "Site 1", count: 50 }]
      },
    });
  } catch (error) {
    logger.error('Error fetching dashboard KPIs:', error.message);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: 'Error fetching dashboard data' });
  }
};