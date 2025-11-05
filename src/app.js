import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import logger from './config/logger.js';
import { HTTP_STATUS } from './utils/constants.js';

// --- Import Routes ---
import webhookRoutes from './routes/webhookRoutes.js';
// --- ADDED ---
import leadRoutes from './routes/leadRoutes.js';
import sourceRoutes from './routes/sourceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import reportRoutes from './routes/reportRoutes.js';

// --- Import Middlewares ---
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

// --- Initialize Express App ---
const app = express();
// --- CORS Configuration ---
const VERCEL_URL = 'https://management-system-capave.vercel.app/';
// --- Core Middlewares ---
app.use(cors({
  origin: [VERCEL_URL, 'http://localhost:5173'], // Allow Vercel and local dev
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const morganFormat = process.env.NODE_ENV === 'development' ? 'dev' : 'combined';
app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// --- API Routes ---
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Lead System API is running 🚀',
    environment: process.env.NODE_ENV,
  });
});


// Health check route
app.get('/health', (req, res) => {
  res
    .status(HTTP_STATUS.OK)
    .json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Mount all webhook routes under /api/webhooks
app.use('/api/webhooks', webhookRoutes);

// --- (Future) Frontend API Routes ---
// --- UPDATED ---
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/sources', sourceRoutes);
// --- ADDED ---
app.use('/api/reports', reportRoutes);

// --- Error Handling Middlewares ---
app.use(notFoundHandler);
app.use(errorHandler);

export default app;