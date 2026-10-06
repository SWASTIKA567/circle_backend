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
    let tokenData = null;

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
        tokenData = tokenResponse;
        console.log(`[ERP Auth] Token obtained! Keys:`, Object.keys(tokenResponse));
        erpData = await fetchErpUserData(erpAccessToken, tokenResponse);
        console.log(`[ERP Auth] Raw /api/User Response:`, JSON.stringify(erpData));
        erpSuccess = true;
      }
    } catch (erpError) {
      console.warn('[ERP Auth Warning]:', erpError.response?.data || erpError.message);
      // Fallback allowed for existing DB / test accounts
    }

    // 2. If ERP succeeded, find the EXACT logged-in student in the ERP list
    if (erpSuccess && erpData) {
      let rawList = erpData;
      if (rawList && rawList.data && Array.isArray(rawList.data)) rawList = rawList.data;
      if (!Array.isArray(rawList)) rawList = [rawList];

      const cleanId = identifier.trim().toLowerCase();
      const targetUserId = String(tokenData?.['X-UserId'] || tokenData?.userId || tokenData?.UserId || '').trim();
      console.log(`[ERP Auth] Searching for student '${cleanId}' (targetUserId: '${targetUserId}') in ERP list of ${rawList.length} records...`);

      // Priority 1: Match by exact ERP userId returned from /Token endpoint
      let matchedItem = null;
      if (targetUserId) {
        matchedItem = rawList.find((item) => item && String(item.userId || item.id || '').trim() === targetUserId);
      }

      // Priority 2: Match by exact admissionNumber, rollNumber, or email
      if (!matchedItem) {
        matchedItem = rawList.find((item) => {
          if (!item) return false;
          const adm = String(item.admissionNumber || item.admissionNo || '').trim().toLowerCase();
          const roll = String(item.rollNumber || item.rollNo || '').trim().toLowerCase();
          const mail = String(item.email || '').trim().toLowerCase();
          const uid = String(item.userId || '').trim().toLowerCase();

          return (
            (adm && (adm === cleanId || cleanId.includes(adm) || adm.includes(cleanId))) ||
            (roll && (roll === cleanId || cleanId.includes(roll) || roll.includes(cleanId))) ||
            (mail && (mail === cleanId || cleanId.includes(mail) || mail.includes(cleanId))) ||
            (uid && uid === cleanId)
          );
        });
      }

      // Priority 3: Match inside userDetails
      if (!matchedItem) {
        matchedItem = rawList.find((item) => {
          if (!item || !item.userDetails) return false;
          try {
            const parsed = typeof item.userDetails === 'string' ? JSON.parse(item.userDetails) : item.userDetails;
            const adm = String(parsed.admissionNumber || parsed.admissionNo || '').trim().toLowerCase();
            const roll = String(parsed.rollNumber || parsed.jeeRollNumber || '').trim().toLowerCase();
            const mail = String(parsed.email || '').trim().toLowerCase();
            return (
              (adm && (adm === cleanId || cleanId.includes(adm) || adm.includes(cleanId))) ||
              (roll && (roll === cleanId || cleanId.includes(roll) || roll.includes(cleanId))) ||
              (mail && (mail === cleanId || cleanId.includes(mail) || mail.includes(cleanId)))
            );
          } catch (_) {
            return false;
          }
        });
      }

      // Fallback to first if only one record returned or not found
      let profile = matchedItem || rawList[0];

      // Parse nested userDetails if it exists as a JSON string
      let deepDetails = {};
      if (profile.userDetails) {
        try {
          deepDetails = typeof profile.userDetails === 'string' ? JSON.parse(profile.userDetails) : profile.userDetails;
        } catch (_) {}
      }

      console.log(`[ERP Auth] Matched Student:`, profile.firstName, profile.lastName, 'AdmissionNo:', profile.admissionNumber);

      const fName = profile.firstName || deepDetails.firstName || '';
      const lName = profile.lastName || deepDetails.lastName || '';
      const admNo = (deepDetails.admissionNumber || profile.admissionNumber || deepDetails.admissionNo || profile.admissionNo || identifier).trim().toUpperCase();
      const uEmail = (deepDetails.email || profile.email || `${admNo.toLowerCase()}@akgec.ac.in`).trim().toLowerCase();
      const fNameFull = `${fName} ${lName}`.trim() || profile.name || identifier;
      
      // 1. Parse Course (e.g. B.Tech, MCA)
      let cCourse = deepDetails.selectedCourse || profile.courseName || deepDetails.courseTitle || profile.batchName?.split('(')[0] || 'B.Tech';
      if (/^B\.?TECH/i.test(cCourse)) cCourse = 'B.Tech';
      if (/^MCA/i.test(cCourse)) cCourse = 'MCA';

      // 2. Parse Semester (extract current active semester from batchName, fallback to deepDetails)
      let semNum = null;
      const bName = profile.batchName || '';
      if (bName) {
        if (/VIII\s*Sem/i.test(bName)) semNum = '8';
        else if (/VII\s*Sem/i.test(bName)) semNum = '7';
        else if (/VI\s*Sem/i.test(bName)) semNum = '6';
        else if (/V\s*Sem/i.test(bName)) semNum = '5';
        else if (/IV\s*Sem/i.test(bName)) semNum = '4';
        else if (/III\s*Sem/i.test(bName)) semNum = '3';
        else if (/II\s*Sem/i.test(bName)) semNum = '2';
        else if (/I\s*Sem/i.test(bName)) semNum = '1';
        else {
          const semMatch = bName.match(/(\d+)\s*(?:st|nd|rd|th)?\s*Sem/i);
          if (semMatch) semNum = semMatch[1];
        }
      }

      if (!semNum && (deepDetails.selectedSemester || profile.semester)) {
        const rawSemStr = String(deepDetails.selectedSemester || profile.semester || '');
        const match = rawSemStr.match(/\d+/);
        if (match) semNum = match[0];
      }

      const sSemester = semNum ? `Semester ${semNum}` : 'Semester 1';

      // 3. Parse Branch (extract from batchName, admission number code, or deepDetails)
      const branchMap = {
        'IT': 'Information Technology',
        'CSE': 'Computer Science & Engineering',
        'CS': 'Computer Science',
        'CSIT': 'Computer Science & Information Technology',
        'ECE': 'Electronics & Communication Engineering',
        'EN': 'Electrical & Electronics Engineering',
        'ME': 'Mechanical Engineering',
        'CIVIL': 'Civil Engineering',
        'CE': 'Civil Engineering',
        'MCA': 'Master of Computer Applications',
      };

      let parsedBranch = '';
      if (bName) {
        const semPart = bName.split(/Sem[_\s]+/i)[1];
        if (semPart) {
          const match = semPart.match(/^([A-Za-z]+(?:\([A-Za-z+ ]+\))?)/);
          if (match) parsedBranch = match[1].trim();
        }
      }

      let bBranch = deepDetails.selectedBranch || profile.branchName || '';
      if (!bBranch || bBranch.toLowerCase().includes('year')) {
        bBranch = parsedBranch || '';
      }

      // AKGEC Admission number branch decoding fallback (e.g. 2413200 -> 13 -> IT)
      if ((!bBranch || bBranch.toLowerCase().includes('year')) && admNo.length >= 4) {
        const code3 = admNo.substring(2, 5);
        const code = admNo.substring(2, 4);
        if (code3 === '154' || code3 === '151') bBranch = 'CSE (AIML & DS)';
        else if (code === '10') bBranch = 'CSE';
        else if (code === '11') bBranch = 'CSIT';
        else if (code === '12') bBranch = 'CS';
        else if (code === '13') bBranch = 'IT';
        else if (code === '14') bBranch = 'MCA';
        else if (code === '20' || code === '21') bBranch = 'EN';
        else if (code === '31') bBranch = 'ECE';
        else if (code === '40') bBranch = 'ME';
        else if (code === '00') bBranch = 'Civil Engineering';
      }

      const niceBranch = branchMap[bBranch.toUpperCase()] || bBranch || 'Computer Science & Engineering';
      bBranch = niceBranch;
      
      const mMobile = deepDetails.phone || deepDetails.smsMobileNumber || profile.parentMobileNumber || deepDetails.parentPhone || '';
      const dDob = deepDetails.dob || profile.dob || '';
      const bBlood = deepDetails.bloodGroup || profile.bloodGroup || '';
      const fFather = deepDetails.fatherName || profile.fatherName || '';
      const mMother = deepDetails.motherName || profile.motherName || '';
      const jJee = deepDetails.jeeRank || profile.jeeRank || null;
      const hHigh = deepDetails.tenthClassPercentage || profile.tenthPercentageObtained || '';
      const iInter = deepDetails.twelthClassPercentage || profile.twelfthpercentageObtained || '';
      const bBank = deepDetails.nameOfBank || profile.bankName || '';
      const iIfsc = deepDetails.iFSCCode || profile.ifsccode || '';
      const aAddr = deepDetails.address || profile.address || deepDetails.permenentAddress || '';

      let user = await User.findOne({
        $or: [
          { studentNo: admNo },
          { email: uEmail },
        ],
      });

      if (!user) {
        // Create new user automatically from ERP data
        user = await User.create({
          name: fNameFull,
          firstName: fName,
          lastName: lName,
          studentNo: admNo,
          admissionNo: admNo,
          email: uEmail,
          course: cCourse,
          branch: bBranch,
          semester: sSemester,
          mobileNo: mMobile,
          dob: dDob,
          bloodGroup: bBlood,
          fatherName: fFather,
          motherName: mMother,
          jeeRank: jJee,
          highSchoolPercentage: hHigh,
          intermediatePercentage: iInter,
          bankName: bBank,
          ifscCode: iIfsc,
          address: aAddr,
          password: password,
        });
      } else {
        // Update user record with latest ERP details
        user.name = fNameFull;
        if (fName) user.firstName = fName;
        if (lName) user.lastName = lName;
        if (admNo) user.admissionNo = admNo;
        if (cCourse) user.course = cCourse;
        if (bBranch) user.branch = bBranch;
        if (sSemester) user.semester = sSemester;
        if (mMobile) user.mobileNo = mMobile;
        if (dDob) user.dob = dDob;
        if (bBlood) user.bloodGroup = bBlood;
        if (fFather) user.fatherName = fFather;
        if (mMother) user.motherName = mMother;
        if (jJee != null) user.jeeRank = jJee;
        if (hHigh) user.highSchoolPercentage = hHigh;
        if (iInter) user.intermediatePercentage = iInter;
        if (bBank) user.bankName = bBank;
        if (iIfsc) user.ifscCode = iIfsc;
        if (aAddr) user.address = aAddr;
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

// @desc    Update society member status
// @route   PUT /api/auth/society-status
// @access  Private (Protected by JWT)
const updateSocietyStatus = async (req, res) => {
  try {
    const { isSocietyMember } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    user.isSocietyMember = Boolean(isSocietyMember);
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Society status updated successfully',
      user: user.toCleanObject(),
    });
  } catch (error) {
    console.error('UpdateSocietyStatus error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error updating society status',
    });
  }
};

module.exports = {
  register,
  login,
  getMe,
  updateSocietyStatus,
};

