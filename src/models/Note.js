const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a note title'],
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters'],
    },
    subject: {
      type: String,
      required: [true, 'Please provide a subject'],
      trim: true,
    },
    semester: {
      type: String,
      default: 'Semester 1',
      trim: true,
    },
    author: {
      type: String,
      default: 'Anonymous',
      trim: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    fileName: {
      type: String,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    pages: {
      type: String,
      default: 'PDF',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Note', noteSchema);
