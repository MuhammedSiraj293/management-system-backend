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

// --- NEW FUNCTION ADDED ---

/**
 * Fetches lead count data grouped by day for dashboard charts.
 * Defaults to the last 28 days.
 */
export const getLeadsOverTime = async (req, res) => {
  try {
    // 1. Determine date range (default to 28 days)
    const period = req.query.period || '28d';
    let daysToSubtract = 28;
    if (period === '7d') daysToSubtract = 7;
    if (period === '14d') daysToSubtract = 14;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToSubtract);
    startDate.setHours(0, 0, 0, 0); // Set to start of the day

    // 2. Build MongoDB Aggregation Pipeline
    const results = await Lead.aggregate([
      // Stage 1: Filter leads within the date range
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      // Stage 2: Group leads by the day they were created
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d', // Group by YYYY-MM-DD
              date: '$createdAt',
              timezone: 'Asia/Dubai', // Use your local timezone
            },
          },
          count: { $sum: 1 }, // Count leads in each group
        },
      },
      // Stage 3: Sort the results by date
      {
        $sort: {
          _id: 1, // Sort ascending (oldest to newest)
        },
      },
      // Stage 4: Rename '_id' to 'date' for easier use on frontend
      {
        $project: {
          _id: 0, // Remove the ugly _id
          date: '$_id',
          count: '$count',
        },
      },
    ]);

    // 3. Send the formatted data
    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: results, // e.g., [{ date: '2025-11-08', count: 5 }, { date: '2025-11-09', count: 12 }]
    });

  } catch (error) {
    logger.error('Error fetching leads over time data:', error.message);
    res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: 'Error fetching chart data' });
  }
};
// --- END NEW FUNCTION ---