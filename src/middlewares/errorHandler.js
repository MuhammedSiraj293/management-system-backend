// backend/src/middlewares/errorHandler.js

import logger from '../config/logger.js';
import { HTTP_STATUS } from '../utils/constants.js';

/**
 * 404 Not Found Handler
 * This middleware catches any request that doesn't match a defined route.
 */
export const notFoundHandler = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(HTTP_STATUS.NOT_FOUND);
  next(error); // Pass the error to the global error handler
};

/**
 * Global Error Handler
 * This is the "catch-all" error handler that all errors
 * are passed to. It formats the error and sends a
 * clean JSON response to the client.
 */
export const errorHandler = (err, req, res, next) => {
  // Sometimes, an error might already have a status code (like 404)
  let statusCode =
    res.statusCode === HTTP_STATUS.OK
      ? HTTP_STATUS.INTERNAL_SERVER_ERROR
      : res.statusCode;

  // Set the status code on the response
  res.status(statusCode);

  // Log the error using our logger
  logger.error(err.message, {
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  // Send a JSON response
  res.json({
    success: false,
    message: err.message,
    // Only include the stack trace in development mode
    stack: process.env.NODE_ENV === 'development' ? err.stack : '🥞',
  });
};