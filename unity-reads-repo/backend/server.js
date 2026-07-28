const express = require('express');
const cors = require('cors');

const app = express();

// 1. Configure CORS to explicitly allow GitHub Pages origin
app.use(cors({
  origin: ['https://james84-bot.github.io', 'http://localhost:3000', 'http://127.0.0.1:5500'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// 2. Explicitly handle preflight OPTIONS requests across all routes
app.options('*', cors());

// 3. Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. Registration route
app.post('/webhook/library-registration', (req, res) => {
  console.log('Registration attempt:', req.body);
  
  return res.status(200).json({
    success: true,
    message: 'Account created successfully',
    userId: req.body.phone || req.body.workEmail
  });
});

// Port configuration for Railway
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});