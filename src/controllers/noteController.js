const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Readable } = require('stream');
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
        resource_type: 'raw',
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

// Helper to upload buffer to MongoDB GridFS (permanent cloud database storage, immune to redeploy wipes)
const uploadBufferToGridFS = (fileBuffer, originalName) => {
  return new Promise((resolve, reject) => {
    if (!mongoose.connection.db) {
      return reject(new Error('MongoDB connection is not ready for GridFS'));
    }

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'notes_files',
    });

    const cleanName = (originalName || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${Date.now()}_${cleanName}`;

    const readableStream = new Readable();
    readableStream.push(fileBuffer);
    readableStream.push(null);

    const uploadStream = bucket.openUploadStream(filename, {
      contentType: 'application/pdf',
      metadata: { originalName },
    });

    readableStream.pipe(uploadStream)
      .on('error', (err) => reject(err))
      .on('finish', () => {
        resolve({
          gridFsId: uploadStream.id,
          filename: filename,
        });
      });
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

    const { title, subject, semester, unit, author, branch } = req.body;

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
    let gridFsId = null;

    // 1. Try Cloudinary if configured with valid credentials
    const hasCloudinary = Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET &&
      process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name' &&
      process.env.CLOUDINARY_CLOUD_NAME !== 'circle'
    );

    if (hasCloudinary && req.file.buffer) {
      try {
        const uploadResult = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname);
        fileUrl = uploadResult.secure_url || uploadResult.url;
        cloudinaryPublicId = uploadResult.public_id;
      } catch (cloudErr) {
        console.warn('Cloudinary upload failed. Falling back to MongoDB GridFS:', cloudErr.message || cloudErr);
      }
    }

    // 2. Primary Permanent Storage: MongoDB GridFS (never lost on server restart or redeploy)
    if (!fileUrl && req.file.buffer && mongoose.connection.readyState === 1) {
      try {
        const gridResult = await uploadBufferToGridFS(req.file.buffer, req.file.originalname);
        gridFsId = gridResult.gridFsId;
      } catch (gridErr) {
        console.warn('GridFS upload failed, falling back to local disk:', gridErr.message);
      }
    }

    // 3. Local disk storage fallback (only if Cloudinary and GridFS failed)
    if (!fileUrl && !gridFsId) {
      const notesDir = path.join(__dirname, '../../uploads/notes');
      if (!fs.existsSync(notesDir)) {
        fs.mkdirSync(notesDir, { recursive: true });
      }
      const cleanName = (req.file.originalname || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeName = `${Date.now()}_${cleanName}`;
      const filePath = path.join(notesDir, safeName);

      if (req.file.buffer) {
        fs.writeFileSync(filePath, req.file.buffer);
      } else if (req.file.path && fs.existsSync(req.file.path)) {
        fs.copyFileSync(req.file.path, filePath);
      } else {
        throw new Error('File storage configuration error. Missing buffer or file path.');
      }
      fileUrl = `/uploads/notes/${safeName}`;
    }

    const formattedSize = formatBytes(req.file.size);

    const newNote = await Note.create({
      title: title.trim(),
      subject: subject.trim(),
      semester: semester ? semester.trim() : 'Semester 1',
      unit: unit ? unit.trim() : 'Unit 1',
      branch: branch ? branch.trim() : 'All Branches',
      author: noteAuthor,
      uploadedBy,
      fileName: req.file.originalname,
      fileUrl: fileUrl || `/api/notes/file/placeholder`,
      cloudinaryPublicId,
      gridFsId,
      fileSize: req.file.size,
      pages: formattedSize,
      status: 'pending',
      isApproved: false,
    });

    if (gridFsId) {
      newNote.fileUrl = `/api/notes/file/${newNote._id}`;
      await newNote.save();
    }

    return res.status(201).json({
      success: true,
      message: 'Note uploaded successfully! It is submitted and will be reviewed shortly.',
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

// @desc    Get all notes (with optional search and category filter)
//          - Admins see all notes (approved + pending)
//          - Authenticated students see all approved notes PLUS their own pending notes
//          - Unauthenticated visitors see only approved notes
// @route   GET /api/notes
// @access  Public or Protected
exports.getAllNotes = async (req, res) => {
  try {
    const { search, category, branch } = req.query;

    // Visibility filter
    let visibilityFilter;
    if (req.user && (req.user.isAdmin || req.user.role === 'admin')) {
      // Admins see everything
      visibilityFilter = {};
    } else if (req.user && req.user._id) {
      // Student sees all approved notes OR their own uploaded notes
      visibilityFilter = {
        $or: [
          { status: 'approved' },
          { isApproved: true },
          { uploadedBy: req.user._id },
        ],
      };
    } else {
      // Public / guest sees only approved notes
      visibilityFilter = {
        $or: [
          { status: 'approved' },
          { isApproved: true },
        ],
      };
    }

    let filter = { ...visibilityFilter };

    if (category && category !== 'All') {
      filter.subject = { $regex: new RegExp(`^${category}$`, 'i') };
    }

    if (branch && branch !== 'All' && branch !== 'All Branches') {
      filter.branch = { $in: [new RegExp(`^${branch}$`, 'i'), 'All Branches'] };
    }

    if (search && search.trim().length > 0) {
      const searchRegex = new RegExp(search.trim(), 'i');
      const searchConditions = [
        { title: searchRegex },
        { subject: searchRegex },
        { unit: searchRegex },
        { author: searchRegex },
        { branch: searchRegex },
      ];

      if (visibilityFilter.$or) {
        filter.$and = [
          { $or: visibilityFilter.$or },
          { $or: searchConditions },
        ];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
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

// Helper to remove note file (GridFS, Cloudinary, or local disk)
const removeNoteFile = async (note) => {
  if (note.gridFsId && mongoose.connection.readyState === 1 && mongoose.connection.db) {
    try {
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'notes_files',
      });
      await bucket.delete(new mongoose.Types.ObjectId(note.gridFsId));
    } catch (err) {
      console.warn('Failed to delete GridFS file:', err.message);
    }
  }

  if (note.cloudinaryPublicId) {
    try {
      await cloudinary.uploader.destroy(note.cloudinaryPublicId, { resource_type: 'raw' });
    } catch (err) {
      console.warn('Failed to delete Cloudinary file:', err.message);
    }
  } else if (note.fileUrl && !note.fileUrl.startsWith('http') && !note.fileUrl.startsWith('/api/notes/file/')) {
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

    // Check ownership if user is not admin
    if (req.user && !req.user.isAdmin && req.user.role !== 'admin') {
      if (note.uploadedBy && String(note.uploadedBy) !== String(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to delete this note.',
        });
      }
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

// @desc    Download / Stream / Preview note PDF directly
// @route   GET /api/notes/download/:id OR GET /api/notes/file/:id
// @access  Public (if approved) OR Protected (for Admin and Uploader)
exports.downloadNote = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found.',
      });
    }

    // Access control:
    // If approved -> Everyone can view/download
    // If pending -> Only Admin OR the student who uploaded the note
    const isApproved = note.isApproved || note.status === 'approved';
    const isAdmin = req.user && (req.user.isAdmin || req.user.role === 'admin');
    const isUploader = req.user && note.uploadedBy && String(req.user._id) === String(note.uploadedBy);

    if (!isApproved && !isAdmin && !isUploader) {
      return res.status(403).json({
        success: false,
        message: 'This note is currently pending admin approval and is not publicly accessible yet.',
      });
    }

    const downloadFileName = `${note.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

    // 1. If stored in MongoDB GridFS (permanent, never wiped on redeploy)
    if (note.gridFsId && mongoose.connection.readyState === 1 && mongoose.connection.db) {
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'notes_files',
      });

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${downloadFileName}"`,
      });

      const downloadStream = bucket.openDownloadStream(new mongoose.Types.ObjectId(note.gridFsId));
      downloadStream.on('error', (err) => {
        console.error('GridFS stream error:', err);
        return res.status(404).json({ success: false, message: 'PDF file not found in storage.' });
      });

      return downloadStream.pipe(res);
    }

    // 2. If hosted on Cloudinary or external URL, redirect directly
    if (note.fileUrl && note.fileUrl.startsWith('http')) {
      return res.redirect(note.fileUrl);
    }

    // 3. Local disk fallback
    const filePath = path.join(__dirname, '../../', note.fileUrl);
    if (fs.existsSync(filePath)) {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${downloadFileName}"`,
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    return res.status(404).json({
      success: false,
      message: 'PDF file not found on server.',
    });
  } catch (error) {
    console.error('Error downloading note:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to download note.',
    });
  }
};
