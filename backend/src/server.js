const path = require('path');
const express = require('express');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.sample') });

const { ensureSchema, ensureMasterUser } = require('./db');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const dashboardRoutes = require('./routes/dashboard');
const importRoutes = require('./routes/import');
const reportRoutes = require('./routes/reports');
const transactionRoutes = require('./routes/transactions');
const userRoutes = require('./routes/users');
const tenantRoutes = require('./routes/tenants');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/import', importRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tenants', tenantRoutes);

const frontendDist = path.join(__dirname, 'frontend-dist');
app.use(express.static(frontendDist));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

const start = async () => {
  try {
    await ensureSchema();
    await ensureMasterUser();
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
};

start();
