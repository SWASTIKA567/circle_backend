const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Event title is required'],
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  date: {
    type: String,
    default: '',
    trim: true,
  },
  registrationLink: {
    type: String,
    default: '',
    trim: true,
  },
  imageUrl: {
    type: String,
    default: '',
    trim: true,
  },
});

const societySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Society name is mandatory'],
      trim: true,
      unique: true,
      maxlength: [100, 'Society name cannot exceed 100 characters'],
    },
    department: {
      type: String,
      required: [true, 'Department is mandatory'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Description is mandatory'],
      trim: true,
    },
    societyPassword: {
      type: String,
      required: [true, 'Society password is mandatory'],
      minlength: [4, 'Society password must be at least 4 characters long'],
      select: false, // Do not return by default in queries
    },
    logoUrl: {
      type: String,
      default: '',
      trim: true,
    },
    websiteLink: {
      type: String,
      default: '',
      trim: true,
    },
    registrationLink: {
      type: String,
      default: '',
      trim: true,
    },
    domains: {
      type: [String],
      default: [],
    },
    recentEvents: [eventSchema],
    upcomingEvents: [eventSchema],
    category: {
      type: String,
      default: 'Technical',
      enum: ['Technical', 'Cultural', 'Literary', 'Sports', 'General'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdByName: {
      type: String,
      default: 'Society Member',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Hash society password before saving
societySchema.pre('save', async function (next) {
  if (!this.isModified('societyPassword')) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.societyPassword = await bcrypt.hash(this.societyPassword, salt);
  next();
});

// Method to verify society password for editing
societySchema.methods.compareSocietyPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.societyPassword);
};

module.exports = mongoose.model('Society', societySchema);
