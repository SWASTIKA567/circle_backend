const express = require('express');
const router = express.Router();
const { adminProtect } = require('../middleware/authMiddleware');
const {
  getPendingNotes,
  approveNote,
  rejectNote,
} = require('../controllers/noteController');
const {
  getPendingSocieties,
  approveSociety,
  rejectSociety,
} = require('../controllers/societyController');
const Note = require('../models/Note');
const Society = require('../models/Society');
const User = require('../models/User');

// Apply adminProtect to ALL routes in this router
router.use(adminProtect);

// @route   GET /api/admin/stats
// @desc    Get dashboard stats for admin
router.get('/stats', async (req, res) => {
  try {
    const [
      totalUsers,
      totalNotes,
      pendingNotes,
      totalSocieties,
      pendingSocieties,
    ] = await Promise.all([
      User.countDocuments(),
      Note.countDocuments({ $or: [{ status: 'approved' }, { isApproved: true }] }),
      Note.countDocuments({ $or: [{ status: 'pending' }, { isApproved: false }] }),
      Society.countDocuments({ $or: [{ status: 'approved' }, { isApproved: true }] }),
      Society.countDocuments({ $or: [{ status: 'pending' }, { isApproved: false }] }),
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalNotes,
        pendingNotes,
        totalSocieties,
        pendingSocieties,
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch admin stats.',
    });
  }
});

// Pending Notes
router.get('/pending-notes', getPendingNotes);
router.put('/notes/:id/approve', approveNote);
router.delete('/notes/:id/reject', rejectNote);

// Pending Societies
router.get('/pending-societies', getPendingSocieties);
router.put('/societies/:id/approve', approveSociety);
router.delete('/societies/:id/reject', rejectSociety);

module.exports = router;
