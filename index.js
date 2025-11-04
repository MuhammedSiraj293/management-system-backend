// backend/index.js

/**
 * Main application entry point.
 * This file is responsible for loading environment variables
 * and starting the server.
 *
 * We use this separation so that our 'server.js' and 'app.js'
 * can be imported for testing without automatically
 * starting the server or connecting to the DB.
 */

// Load environment variables first
import './config/env.js';

// Start the server
import './server.js';