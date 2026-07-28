const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Enable CORS for your GitHub Pages site
app.use(cors({
  origin: ['https://james84-bot.github.io'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

// Define routes matching app.js
app.post('/webhook/library-auth', (req, res) => {
  console.log('Login payload received:', req.body);
  return res.status(200).json({ status: 'success', message: 'Auth successful' });
});

app.post('/webhook/library-registration', (req, res) => {
  return res.status(200).json({ status: 'success', message: 'Registration successful' });
});

app.get('/webhook/library-sync', (req, res) => {
  return res.status(200).json({ status: 'success', catalog: [] });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));