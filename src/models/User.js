const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    firstName: {
      type: String,
      default: '',
      trim: true,
    },
    lastName: {
      type: String,
      default: '',
      trim: true,
    },
    studentNo: {
      type: String,
      required: [true, 'Please provide a student number'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [30, 'Student number cannot exceed 30 characters'],
    },
    admissionNo: {
      type: String,
      default: '',
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email address'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    course: {
      type: String,
      default: '',
      trim: true,
    },
    branch: {
      type: String,
      default: '',
      trim: true,
    },
    semester: {
      type: String,
      default: '',
      trim: true,
    },
    mobileNo: {
      type: String,
      default: '',
      trim: true,
    },
    dob: {
      type: String,
      default: '',
    },
    bloodGroup: {
      type: String,
      default: '',
    },
    fatherName: {
      type: String,
      default: '',
    },
    motherName: {
      type: String,
      default: '',
    },
    jeeRank: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    highSchoolPercentage: {
      type: String,
      default: '',
    },
    intermediatePercentage: {
      type: String,
      default: '',
    },
    bankName: {
      type: String,
      default: '',
    },
    ifscCode: {
      type: String,
      default: '',
    },
    address: {
      type: String,
      default: '',
    },
    isSocietyMember: {
      type: Boolean,
      default: false,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ['student', 'admin'],
      default: 'student',
    },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters long'],
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password prior to saving if provided/modified
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare entered password with hashed password
userSchema.methods.comparePassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

// Return a clean representation of the user object
userSchema.methods.toCleanObject = function () {
  return {
    id: this._id,
    name: this.name,
    firstName: this.firstName,
    lastName: this.lastName,
    studentNo: this.studentNo,
    admissionNo: this.admissionNo,
    email: this.email,
    course: this.course,
    branch: this.branch,
    semester: this.semester,
    mobileNo: this.mobileNo,
    dob: this.dob,
    bloodGroup: this.bloodGroup,
    fatherName: this.fatherName,
    motherName: this.motherName,
    jeeRank: this.jeeRank,
    highSchoolPercentage: this.highSchoolPercentage,
    intermediatePercentage: this.intermediatePercentage,
    bankName: this.bankName,
    ifscCode: this.ifscCode,
    address: this.address,
    isSocietyMember: this.isSocietyMember,
    isAdmin: this.isAdmin || this.role === 'admin',
    role: this.role || (this.isAdmin ? 'admin' : 'student'),
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
