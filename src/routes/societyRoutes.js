const express = require('express');
const router = express.Router();
const {
  createSociety,
  getAllSocieties,
  getSocietyById,
  verifySocietyPassword,
  updateSociety,
} = require('../controllers/societyController');
const { protect } = require('../middleware/authMiddleware');

// @route   GET /api/societies
// @desc    Get all societies (Public for all users)
router.get('/', getAllSocieties);

// @route   GET /api/societies/:id
// @desc    Get single society details (Public for all users)
router.get('/:id', getSocietyById);

// @route   POST /api/societies
// @desc    Create a new society (Only for verified society members)
router.post('/', protect, createSociety);

// @route   POST /api/societies/:id/verify-password
// @desc    Verify society password before editing
router.post('/:id/verify-password', protect, verifySocietyPassword);

// @route   PUT /api/societies/:id
// @desc    Update society details (Requires society password)
router.put('/:id', protect, updateSociety);

module.exports = router;
