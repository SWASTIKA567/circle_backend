const express = require('express');
const router = express.Router();
const { uploadNote, getAllNotes, deleteNote } = require('../controllers/noteController');
const { protect, optionalProtect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// @route   GET /api/notes
// @desc    Get all notes (supports ?category= & ?search=)
router.get('/', getAllNotes);

// @route   POST /api/notes/upload
// @desc    Upload note with PDF file
router.post('/upload', optionalProtect, upload.single('pdf'), uploadNote);

// @route   DELETE /api/notes/:id
// @desc    Delete a note
router.delete('/:id', protect, deleteNote);

module.exports = router;
