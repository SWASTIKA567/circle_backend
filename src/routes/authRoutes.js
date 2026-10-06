const express = require('express');
const router = express.Router();
const { register, login, getMe, updateSocietyStatus } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/me', protect, getMe);
router.put('/society-status', protect, updateSocietyStatus);

module.exports = router;

