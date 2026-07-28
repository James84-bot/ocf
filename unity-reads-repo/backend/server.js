const express = require('express');
const cors = require('cors');

const app = express();

// ==========================================
// 1. CORS CONFIGURATION
// ==========================================
const allowedOrigins = [
  'https://james84-bot.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Allow during production testing
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Handle preflight OPTIONS requests across all routes
app.options('*', cors());

// ==========================================
// 2. MIDDLEWARE
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 3. HEALTH CHECK ROUTE (Required for Railway)
// ==========================================
app.get('/', (req, res) => {
  res.status(200).send('Unity Shelf Backend is running!');
});

// ==========================================
// 4. API & WEBHOOK ENDPOINTS
// ==========================================

// Library Registration
app.post('/webhook/library-registration', (req, res) => {
  console.log('Registration request received:', req.body);
  return res.status(200).json({
    success: true,
    message: 'Account created successfully',
    data: req.body
  });
});

// Library Auth / Login
app.post('/webhook/library-auth', (req, res) => {
  console.log('Auth request received:', req.body);
  return res.status(200).json({
    success: true,
    message: 'Authenticated successfully'
  });
});

// Library Sync
app.post('/webhook/library-sync', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Library state synced'
  });
});

// Library Update / Transaction
app.post('/webhook/library-update', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Transaction updated'
  });
});

// Change PIN
app.post('/webhook/library-change-pin', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'PIN changed successfully'
  });
});

// Verify Account
//app.post('/webhook/library-verify-account', (req, res) => {
 // return res.status(200).json({
   // success: true,
   // message: 'Account verified'
//  });
//});
// Login / Auth Route
app.post('/webhook/library-auth', (req, res) => {
  console.log('Login attempt received:', req.body);

  return res.status(200).json({
    success: true,
    authenticated: true,
    message: 'Authenticated successfully',
    user: {
      name: req.body.userId || 'Resident',
      role: 'user'
    },
    token: 'mock-jwt-token-12345'
  });
});

// Reserve Book
app.post('/webhook/library-reserve', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Book reserved'
  });
});

// Cancel Reservation
app.post('/webhook/library-cancel-reservation', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Reservation cancelled'
  });
});

// Admin Overview
app.post('/webhook/library-admin-overview', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Admin overview fetched'
  });
});

// ==========================================
// 5. SERVER BINDING & LISTEN
// ==========================================


// Always prefer process.env.PORT provided dynamically by Railway
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});