const fs = require('fs');
const path = require('path');
const Note = require('../models/Note');
const cloudinary = require('../config/cloudinary');

// Format file size nicely (e.g. 1.5 MB)
const formatBytes = (bytes, decimals = 1) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Helper to upload buffer to Cloudinary
const uploadBufferToCloudinary = (fileBuffer, originalName) => {
  return new Promise((resolve, reject) => {
    const cleanName = originalName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw', // 'raw' ensures full PDF document integrity and exact byte preservation
        folder: 'circle_notes',
        public_id: `${Date.now()}_${cleanName}`,
        format: 'pdf',
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
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

    const { title, subject, semester, unit, author } = req.body;

    if (!title || !subject) {
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

    let fileUrl = '';
    let cloudinaryPublicId = null;

    // Check if Cloudinary is configured
    const hasCloudinary = Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    );

    if (hasCloudinary && req.file.buffer) {
      // Upload directly to Cloudinary
      const uploadResult = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname);
      fileUrl = uploadResult.secure_url || uploadResult.url;
      cloudinaryPublicId = uploadResult.public_id;
    } else if (req.file.path) {
      // Fallback for disk storage if used
      fileUrl = `/uploads/notes/${req.file.filename}`;
    } else {
      throw new Error('File storage configuration error. Missing buffer or file path.');
    }

    const formattedSize = formatBytes(req.file.size);

    const newNote = await Note.create({
      title: title.trim(),
      subject: subject.trim(),
      semester: semester ? semester.trim() : 'Semester 1',
      unit: unit ? unit.trim() : 'Unit 1',
      author: noteAuthor,
      uploadedBy,
      fileName: req.file.originalname,
      fileUrl,
      cloudinaryPublicId,
      fileSize: req.file.size,
      pages: formattedSize,
      status: 'pending',
      isApproved: false,
    });

    return res.status(201).json({
      success: true,
      message: 'Note uploaded successfully! It is submitted for Admin approval.',
      note: newNote,
    });
  } catch (error) {
    console.error('Error uploading note:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while uploading note.',
    });
  }
};

// @desc    Get all notes (with optional search and category filter) - Public: ONLY approved notes
// @route   GET /api/notes
// @access  Public
exports.getAllNotes = async (req, res) => {
  try {
    const { search, category } = req.query;
    let filter = {
      $or: [
        { status: 'approved' },
        { isApproved: true },
      ],
    };

    if (category && category !== 'All') {
      filter.subject = { $regex: new RegExp(`^${category}$`, 'i') };
    }

    if (search && search.trim().length > 0) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$and = [
        {
          $or: [
            { status: 'approved' },
            { isApproved: true },
          ],
        },
        {
          $or: [
            { title: searchRegex },
            { subject: searchRegex },
            { unit: searchRegex },
            { author: searchRegex },
          ],
        },
      ];
      delete filter.$or;
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

// @desc    Get all pending notes for Admin review
// @route   GET /api/admin/pending-notes
// @access  Admin
exports.getPendingNotes = async (req, res) => {
  try {
    const pendingNotes = await Note.find({
      $or: [
        { status: 'pending' },
        { isApproved: false, status: { $ne: 'rejected' } },
      ],
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: pendingNotes.length,
      notes: pendingNotes,
    });
  } catch (error) {
    console.error('Error fetching pending notes:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pending notes.',
    });
  }
};

// @desc    Approve a pending note
// @route   PUT /api/admin/notes/:id/approve
// @access  Admin
exports.approveNote = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found.',
      });
    }

    note.status = 'approved';
    note.isApproved = true;
    note.approvedAt = new Date();
    note.approvedBy = req.user ? req.user._id : null;

    await note.save();

    return res.status(200).json({
      success: true,
      message: `Note "${note.title}" approved successfully!`,
      note,
    });
  } catch (error) {
    console.error('Error approving note:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to approve note.',
    });
  }
};

// Helper to remove note file (Cloudinary or local disk)
const removeNoteFile = async (note) => {
  if (note.cloudinaryPublicId) {
    try {
      await cloudinary.uploader.destroy(note.cloudinaryPublicId, { resource_type: 'raw' });
    } catch (err) {
      console.warn('Failed to delete Cloudinary file:', err.message);
    }
  } else if (note.fileUrl && !note.fileUrl.startsWith('http')) {
    const filePath = path.join(__dirname, '../../', note.fileUrl);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn('Could not delete local file:', filePath, err.message);
      }
    }
  }
};

// @desc    Reject / delete a note
// @route   DELETE /api/admin/notes/:id/reject
// @access  Admin
exports.rejectNote = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found.',
      });
    }

    await removeNoteFile(note);
    await note.deleteOne();

    return res.status(200).json({
      success: true,
      message: `Note "${note.title}" rejected and deleted.`,
    });
  } catch (error) {
    console.error('Error rejecting note:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reject note.',
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

    await removeNoteFile(note);
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

// @desc    Download a note PDF file directly
// @route   GET /api/notes/download/:id
// @access  Public (Anyone can download)
exports.downloadNote = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found.',
      });
    }

    // If hosted on Cloudinary or external URL, redirect directly
    if (note.fileUrl && note.fileUrl.startsWith('http')) {
      return res.redirect(note.fileUrl);
    }

    // Local file fallback
    const filePath = path.join(__dirname, '../../', note.fileUrl);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'PDF file not found on server.',
      });
    }

    const downloadFileName = `${note.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    return res.download(filePath, downloadFileName);
  } catch (error) {
    console.error('Error downloading note:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to download note.',
    });
  }
};
