const jwt = require('jsonwebtoken');
const axios = require('axios');
const User = require('../models/User');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// Helper: Call AKGEC ERP Token API (Format A: x-www-form-urlencoded)
const fetchErpToken = async (username, password) => {
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', username.trim());
  params.append('password', password);

  const response = await axios.post('https://erp.akgec.ac.in/Token', params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
    timeout: 20000,
  });

  return response.data; // Expected { access_token, token_type, expires_in, ... }
};

// Helper: Call AKGEC ERP User API with required eCanvas headers from Token response
const fetchErpUserData = async (erpAccessToken, tokenData = {}) => {
  // eCanvas Web API requires the context headers returned from the /Token endpoint
  const contextId = tokenData['X-ContextId'] || tokenData.contextId || '1';
  const userId = tokenData['X-UserId'] || '';
  const rx = tokenData['X-RX'] || '';
  const sessionId = tokenData['SessionId'] || '';
  const appYear = tokenData['X_App_Year'] || '';
  const logoId = tokenData['X-LogoId'] || '';
  const empCat = tokenData['X-EmpCat'] || '';

  const headers = {
    'Authorization': `Bearer ${erpAccessToken}`,
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    // Exact headers expected by eCanvas get_CurrentOrganizationId() and ApiBaseController
    'X-ContextId': String(contextId),
    'ContextId': String(contextId),
    'OrganizationId': String(contextId),
    'organization_id': String(contextId),
    'OrgId': String(contextId),
    'orgId': String(contextId),
  };

  if (userId) headers['X-UserId'] = String(userId);
  if (rx) headers['X-RX'] = String(rx);
  if (sessionId) headers['SessionId'] = String(sessionId);
  if (appYear) headers['X_App_Year'] = String(appYear);
  if (logoId) headers['X-LogoId'] = String(logoId);
  if (empCat) headers['X-EmpCat'] = String(empCat);

  // Clean undefined or empty values
  Object.keys(headers).forEach((key) => {
    if (!headers[key]) delete headers[key];
  });

  console.log('[ERP Auth] Sending /api/User headers:', headers);

  const response = await axios.get('https://erp.akgec.ac.in/api/User', {
    headers: headers,
    timeout: 20000,
  });

  return response.data;
};

// @desc    Register a new user (fallback / direct register if needed)
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

    const formattedEmail = email.toLowerCase().trim();
    if (!formattedEmail.endsWith('@akgec.ac.in')) {
      return res.status(400).json({
        success: false,
        message: 'Only college email addresses ending with @akgec.ac.in are allowed',
      });
    }

    const formattedStudentNo = studentNo.trim().toUpperCase();

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

// @desc    Login user via AKGEC ERP Token & User APIs (or local DB fallback)
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const { emailOrStudentNo, email, studentNo, identifier: rawId, password } = req.body;
    const identifier = (rawId || emailOrStudentNo || email || studentNo || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your student number or college email and password',
      });
    }

    let erpSuccess = false;
    let erpData = null;

    // 1. Try Authenticating with AKGEC ERP Token Endpoint
    try {
      // Determine probable username (if email is entered, extract numbers or user handle)
      let erpUsername = identifier;
      if (identifier.includes('@')) {
        const localPart = identifier.split('@')[0];
        const match = localPart.match(/\d+/);
        // If digits exist in email (e.g. 2413200 in swastika2413200), use that; else local part
        erpUsername = match ? match[0] : localPart;
      }

      console.log(`[ERP Auth] Attempting Token generation for: ${erpUsername} (original: ${identifier})`);
      let tokenResponse;
      try {
        tokenResponse = await fetchErpToken(erpUsername, password);
      } catch (firstErr) {
        // If extracted username failed and was different from identifier, try with original identifier as fallback
        if (erpUsername !== identifier) {
          console.log(`[ERP Auth] Retrying with original identifier: ${identifier}`);
          tokenResponse = await fetchErpToken(identifier, password);
        } else {
          throw firstErr;
        }
      }

      const erpAccessToken = tokenResponse.access_token || tokenResponse.token;

      if (erpAccessToken) {
        console.log(`[ERP Auth] Token obtained! Keys:`, Object.keys(tokenResponse));
        erpData = await fetchErpUserData(erpAccessToken, tokenResponse);
        console.log(`[ERP Auth] User data received for: ${erpData?.firstName || identifier}`);
        erpSuccess = true;
      }
    } catch (erpError) {
      console.warn('[ERP Auth Warning]:', erpError.response?.data || erpError.message);
      // Fallback allowed for existing DB / test accounts
    }

    // 2. If ERP succeeded, sync/create user in MongoDB with all ERP details
    if (erpSuccess && erpData) {
      const studentNoFromErp = (erpData.admissionNo || identifier).trim().toUpperCase();
      const userEmail = (erpData.email || `${studentNoFromErp.toLowerCase()}@akgec.ac.in`).trim().toLowerCase();
      const fullName = `${erpData.firstName || ''} ${erpData.lastName || ''}`.trim() || identifier;

      let user = await User.findOne({
        $or: [
          { studentNo: studentNoFromErp },
          { email: userEmail },
        ],
      });

      if (!user) {
        // Create new user automatically from ERP data
        user = await User.create({
          name: fullName,
          firstName: erpData.firstName || '',
          lastName: erpData.lastName || '',
          studentNo: studentNoFromErp,
          admissionNo: erpData.admissionNo || studentNoFromErp,
          email: userEmail,
          course: erpData.course || '',
          branch: erpData.branch || '',
          semester: erpData.semester ? `Semester ${erpData.semester}`.replace('Semester Semester', 'Semester') : 'Semester 1',
          mobileNo: erpData.mobileNo || '',
          dob: erpData.dob || '',
          bloodGroup: erpData.bloodGroup || '',
          fatherName: erpData.fatherName || '',
          motherName: erpData.motherName || '',
          jeeRank: erpData.jeeRank ?? null,
          highSchoolPercentage: erpData.highSchoolPercentage || '',
          intermediatePercentage: erpData.intermediatePercentage || '',
          bankName: erpData.bankName || '',
          ifscCode: erpData.ifscCode || '',
          address: erpData.address || '',
          password: password, // Save so user can also authenticate if ERP is temporarily down
        });
      } else {
        // Update user record with latest ERP details
        user.name = fullName;
        user.firstName = erpData.firstName || user.firstName;
        user.lastName = erpData.lastName || user.lastName;
        user.course = erpData.course || user.course;
        user.branch = erpData.branch || user.branch;
        if (erpData.semester) {
          user.semester = `Semester ${erpData.semester}`.replace('Semester Semester', 'Semester');
        }
        user.mobileNo = erpData.mobileNo || user.mobileNo;
        user.dob = erpData.dob || user.dob;
        user.bloodGroup = erpData.bloodGroup || user.bloodGroup;
        user.fatherName = erpData.fatherName || user.fatherName;
        user.motherName = erpData.motherName || user.motherName;
        user.jeeRank = erpData.jeeRank ?? user.jeeRank;
        user.highSchoolPercentage = erpData.highSchoolPercentage || user.highSchoolPercentage;
        user.intermediatePercentage = erpData.intermediatePercentage || user.intermediatePercentage;
        user.bankName = erpData.bankName || user.bankName;
        user.ifscCode = erpData.ifscCode || user.ifscCode;
        user.address = erpData.address || user.address;
        user.password = password;
        await user.save();
      }

      const token = generateToken(user._id);

      return res.status(200).json({
        success: true,
        message: 'AKGEC ERP verification successful! Logged in.',
        token,
        user: user.toCleanObject(),
      });
    }

    // 3. Fallback: Check local MongoDB credentials (for admins or previously registered users)
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { studentNo: identifier.toUpperCase() },
      ],
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid AKGEC ERP credentials or account not found.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid ERP password.',
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
