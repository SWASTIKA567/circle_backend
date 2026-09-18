const express = require('express');
const router = express.Router();
const { uploadNote, getAllNotes, deleteNote, downloadNote } = require('../controllers/noteController');
const { protect, optionalProtect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// @route   GET /api/notes
// @desc    Get all notes (supports ?category= & ?search=)
// Accessible by EVERYONE using the app
router.get('/', getAllNotes);

// @route   GET /api/notes/download/:id
// @desc    Download note PDF attachment directly
// Accessible by EVERYONE using the app
router.get('/download/:id', downloadNote);

// @route   POST /api/notes/upload
// @desc    Upload note with PDF file (any user can upload)
router.post('/upload', optionalProtect, upload.single('pdf'), uploadNote);

// @route   DELETE /api/notes/:id
// @desc    Delete a note
router.delete('/:id', protect, deleteNote);

module.exports = router;
