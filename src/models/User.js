const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    studentNo: {
      type: String,
      required: [true, 'Please provide a student number'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [30, 'Student number cannot exceed 30 characters'],
    },
    email: {
      type: String,
      required: [true, 'Please provide an email address'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address',
      ],
    },
    isSocietyMember: {
      type: Boolean,
      default: false,
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [6, 'Password must be at least 6 characters long'],
      select: false, // Do not return password by default in queries
    },
  },
  {
    timestamps: true,
  }
);

// Hash password prior to saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare entered password with hashed password
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Return a clean representation of the user object
userSchema.methods.toCleanObject = function () {
  return {
    id: this._id,
    name: this.name,
    studentNo: this.studentNo,
    email: this.email,
    isSocietyMember: this.isSocietyMember,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
