const fs = require('fs');
const path = require('path');
const Note = require('../models/Note');

// Format file size nicely (e.g. 1.5 MB)
const formatBytes = (bytes, decimals = 1) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// @desc    Upload a new note (PDF)
// @route   POST /api/notes/upload
// @access  Public or Protected
exports.uploadNote = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a PDF file.',
      });
    }

    const { title, subject, semester, author } = req.body;

    if (!title || !subject) {
      // Remove uploaded file if validation fails
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: 'Title and subject are required fields.',
      });
    }

    // Determine author
    let noteAuthor = author || 'Anonymous';
    let uploadedBy = null;

    if (req.user) {
      noteAuthor = req.user.name || noteAuthor;
      uploadedBy = req.user._id;
    }

    // Relative URL for serving static file
    const fileUrl = `/uploads/notes/${req.file.filename}`;
    const formattedSize = formatBytes(req.file.size);

    const newNote = await Note.create({
      title: title.trim(),
      subject: subject.trim(),
      semester: semester ? semester.trim() : 'Semester 1',
      author: noteAuthor,
      uploadedBy,
      fileName: req.file.originalname,
      fileUrl,
      fileSize: req.file.size,
      pages: formattedSize, // Displays size / type in UI
    });

    return res.status(201).json({
      success: true,
      message: 'Note uploaded successfully!',
      note: newNote,
    });
  } catch (error) {
    console.error('Error uploading note:', error);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
    }
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while uploading note.',
    });
  }
};

// @desc    Get all notes (with optional search and category filter)
// @route   GET /api/notes
// @access  Public
exports.getAllNotes = async (req, res) => {
  try {
    const { search, category } = req.query;
    let filter = {};

    if (category && category !== 'All') {
      filter.subject = { $regex: new RegExp(`^${category}$`, 'i') };
    }

    if (search && search.trim().length > 0) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { title: searchRegex },
        { subject: searchRegex },
        { author: searchRegex },
      ];
    }

    const notes = await Note.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: notes.length,
      notes,
    });
  } catch (error) {
    console.error('Error fetching notes:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch notes.',
    });
  }
};

// @desc    Delete a note by ID
// @route   DELETE /api/notes/:id
// @access  Public or Protected
exports.deleteNote = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found.',
      });
    }

    // Attempt to remove physical file
    if (note.fileUrl) {
      const filePath = path.join(__dirname, '../../', note.fileUrl);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.warn('Could not delete file:', filePath, err);
        }
      }
    }

    await note.deleteOne();

    return res.status(200).json({
      success: true,
      message: 'Note deleted successfully.',
    });
  } catch (error) {
    console.error('Error deleting note:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete note.',
    });
  }
};
