import Source from '../models/Source.js';
import { HTTP_STATUS } from '../utils/constants.js';

/**
 * Middleware to verify the 'token' from a webhook query string.
 * This is used to identify and authenticate which source (e.g., which
 * Elementor site) is sending the data.
 */
const verifyWebhookToken = async (req, res, next) => {
  const token = req.query.token;

  // 1. Check if token is present
  if (!token) {
    console.warn('Webhook blocked: No token provided.');
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
  }

  try {
    // 2. Find the source in the database by its identifier token
    const source = await Source.findOne({ identifierToken: token });

    // 3. Check if a source was found
    if (!source) {
      console.warn(`Webhook blocked: Invalid token: ${token}`);
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Invalid token.',
      });
    }

    // 4. Check if the found source is marked as active
    if (!source.isActive) {
      console.warn(`Webhook blocked: Source is inactive: ${source.name}`);
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: `Source '${source.name}' is inactive.`,
      });
    }

    // 5. Success! Attach the source to the request object
    // The controller can now access 'req.source' to know
    // which website sent the lead.
    req.source = source;
    next();
  } catch (error) {
    console.error('Error in verifyWebhookToken middleware:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error during authentication.',
    });
  }
};

export default verifyWebhookToken;