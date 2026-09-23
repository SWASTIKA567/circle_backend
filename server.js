const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const chatbotRoutes = require('./src/routes/chatbotRoutes');
const noteRoutes = require('./src/routes/noteRoutes');
const societyRoutes = require('./src/routes/societyRoutes');
const adminRoutes = require('./src/routes/adminRoutes');

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/societies', societyRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    appName: 'Circle Auth API',
    timestamp: new Date().toISOString(),
  });
});

// Root welcome endpoint
app.get('/', (req, res) => {
  res.send(`
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 90vh; background-color: #f8fafc; color: #1e1b4b;">
      <div style="text-align: center; padding: 40px; background: white; border-radius: 16px; box-shadow: 0 10px 25px rgba(79, 70, 229, 0.1); border: 1px solid #e0e7ff;">
        <div style="width: 60px; height: 60px; background: #4f46e5; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px;">C</div>
        <h1 style="color: #4f46e5; margin: 0 0 10px 0;">Circle Backend API</h1>
        <p style="color: #64748b; margin: 0 0 20px 0;">Node.js Express & MongoDB Authentication Server</p>
        <div style="background: #eef2ff; color: #4338ca; padding: 10px 16px; border-radius: 8px; font-size: 14px; font-weight: 500;">
          Status: Active & Ready on Port ${process.env.PORT || 5000}
        </div>
      </div>
    </div>
  `);
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`[Circle Backend Server] running on http://localhost:${PORT}`);
  console.log(`[Auth Endpoints]:`);
  console.log(`  - POST http://localhost:${PORT}/api/auth/register`);
  console.log(`  - POST http://localhost:${PORT}/api/auth/login`);
  console.log(`  - GET  http://localhost:${PORT}/api/auth/me`);
  console.log(`  - POST http://localhost:${PORT}/api/chatbot/ask`);
  console.log(`[Notes Endpoints]:`);
  console.log(`  - GET  http://localhost:${PORT}/api/notes`);
  console.log(`  - POST http://localhost:${PORT}/api/notes/upload`);
  console.log(`[Societies Endpoints]:`);
  console.log(`  - GET  http://localhost:${PORT}/api/societies`);
  console.log(`  - POST http://localhost:${PORT}/api/societies`);
  console.log(`  - PUT  http://localhost:${PORT}/api/societies/:id`);
  console.log(`========================================`);
});
