const express = require('express');
const router = express.Router();
const { uploadNote, getAllNotes, deleteNote, downloadNote } = require('../controllers/noteController');
const { protect, optionalProtect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// @route   GET /api/notes
// @desc    Get all notes (supports ?category= & ?search=)
// Authenticated students see approved notes + their own pending notes. Admins see all notes.
router.get('/', optionalProtect, getAllNotes);

// @route   GET /api/notes/file/:id
// @desc    Stream PDF for preview / inline viewing
router.get('/file/:id', optionalProtect, downloadNote);

// @route   GET /api/notes/download/:id
// @desc    Download note PDF attachment directly
router.get('/download/:id', optionalProtect, downloadNote);

// @route   POST /api/notes/upload
// @desc    Upload note with PDF file (any user can upload)
router.post('/upload', optionalProtect, upload.single('pdf'), uploadNote);

// @route   DELETE /api/notes/:id
// @desc    Delete a note
router.delete('/:id', protect, deleteNote);

module.exports = router;
