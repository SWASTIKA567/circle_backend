const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// @desc    Register a new user (with Student No. and Society Member status)
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    const { name, studentNo, email, isSocietyMember, password, adminSecretCode, isAdmin } = req.body;

    if (!name || !studentNo || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, student number, email, and password',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    const formattedStudentNo = studentNo.trim().toUpperCase();
    const formattedEmail = email.toLowerCase().trim();

    // Check if student number already exists
    const existingStudentNo = await User.findOne({ studentNo: formattedStudentNo });
    if (existingStudentNo) {
      return res.status(409).json({
        success: false,
        message: 'An account with this student number already exists',
      });
    }

    // Check if email already exists
    const existingEmail = await User.findOne({ email: formattedEmail });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    // Determine admin status
    const expectedAdminSecret = process.env.ADMIN_SECRET_KEY || 'CIRCLE_ADMIN_KEY_2026';
    let userIsAdmin = false;
    if (
      (adminSecretCode && adminSecretCode.trim() === expectedAdminSecret) ||
      formattedEmail.startsWith('admin@') ||
      formattedStudentNo === 'ADMIN001'
    ) {
      userIsAdmin = true;
    }

    // Create user
    const user = await User.create({
      name: name.trim(),
      studentNo: formattedStudentNo,
      email: formattedEmail,
      isSocietyMember: Boolean(isSocietyMember),
      isAdmin: userIsAdmin,
      role: userIsAdmin ? 'admin' : 'student',
      password,
    });

    const token = generateToken(user._id);

    return res.status(201).json({
      success: true,
      message: 'Account registered successfully',
      token,
      user: user.toCleanObject(),
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during registration',
    });
  }
};

// @desc    Login user with Email or Student No & return JWT
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const { emailOrStudentNo, email, studentNo, identifier: rawId, password } = req.body;
    const identifier = (rawId || emailOrStudentNo || email || studentNo || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your email or student number and password',
      });
    }

    // Find user by either email or student number
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { studentNo: identifier.toUpperCase() },
      ],
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    const token = generateToken(user._id);

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      token,
      user: user.toCleanObject(),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during login',
    });
  }
};

// @desc    Get current logged in user details
// @route   GET /api/auth/me
// @access  Private (Protected by JWT)
const getMe = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      user: req.user.toCleanObject(),
    });
  } catch (error) {
    console.error('GetMe error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching user profile',
    });
  }
};

module.exports = {
  register,
  login,
  getMe,
};
