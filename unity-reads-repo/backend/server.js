const express = require('express');
const cors = require('cors');

const app = express();

// 1. Enable CORS for all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 2. Handle preflight OPTIONS requests for all endpoints
app.options('*', cors());

// 3. Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. Registration route
app.post('/webhook/library-registration', (req, res) => {
  console.log('Registration request received:', req.body);
  return res.status(200).json({
    status: 'success',
    message: 'Registered successfully',
    user: req.body
  });
});

// Port binding for Railway
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});