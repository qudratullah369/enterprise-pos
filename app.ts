import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error.middleware.js';
import { authenticate } from './middleware/auth.middleware.js';

import authRoutes from './modules/auth/auth.routes.js';
import salesRoutes from './modules/sales/sales.routes.js';
import productsRoutes from './modules/products/products.routes.js';
import purchasesRoutes from './modules/purchases/purchases.routes.js';
import customersRoutes from './modules/customers/customers.routes.js';
import suppliersRoutes from './modules/suppliers/suppliers.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import cashRegistersRoutes from './modules/cash-registers/cash-registers.routes.js';
import categoriesRoutes from './modules/categories/categories.routes.js';
import receiptsRoutes from './modules/receipts/receipts.routes.js';
import branchesRoutes from './modules/branches/branches.routes.js';
import printersRoutes from './modules/printers/printers.routes.js';
import taxProfilesRoutes from './modules/tax-profiles/tax-profiles.routes.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/cash-registers', cashRegistersRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/receipts', receiptsRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/printers', printersRoutes);
app.use('/api/tax-profiles', taxProfilesRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

export default app;
