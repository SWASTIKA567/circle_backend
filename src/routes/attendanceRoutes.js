const express = require('express');
const router = express.Router();
const { getStudentAttendance } = require('../controllers/attendanceController');
const { protect } = require('../middleware/authMiddleware');

// @route   GET /api/attendance
// @desc    Get student attendance records directly from AKGEC ERP
// @access  Protected (Requires student login)
router.get('/', protect, getStudentAttendance);

module.exports = router;
