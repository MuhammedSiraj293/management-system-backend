import winston from 'winston';
import env from './env.js';

const { combine, timestamp, printf, colorize, align } = winston.format;

/**
 * Custom log format
 */
const logFormat = printf(({ level, message, timestamp, stack }) => {
  if (stack) {
    // For errors, include the stack trace
    return `${timestamp} [${level}]: ${message}\n${stack}`;
  }
  return `${timestamp} [${level}]: ${message}`;
});

/**
 * A simple logger utility using Winston.
 * It logs to the console with different formats for development and production.
 */
const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  
  transports: [
    // In development, log with colors
    new winston.transports.Console({
      format: combine(
        colorize(),
        align(),
        timestamp({ format: 'HH:mm:ss' }), // Shorter timestamp for dev
        logFormat
      ),
    }),
  ],

  // Do not exit on handled exceptions
  exitOnError: false,
});

// In production, we would also add a transport to log to a file
if (env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    })
  );
  logger.add(
    new winston.transports.File({ filename: 'logs/combined.log' })
  );
}

export default logger;