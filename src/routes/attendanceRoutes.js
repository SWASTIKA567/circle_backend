const express = require('express');
const router = express.Router();
const { getStudentAttendance, linkErpCredentials } = require('../controllers/attendanceController');
const { protect } = require('../middleware/authMiddleware');

// @route   GET /api/attendance
// @desc    Get student attendance records directly from AKGEC ERP
// @access  Protected (Requires student login)
router.get('/', protect, getStudentAttendance);

// @route   POST /api/attendance/link
// @desc    Link ERP password and sync attendance directly for active session
// @access  Protected
router.post('/link', protect, linkErpCredentials);

module.exports = router;
