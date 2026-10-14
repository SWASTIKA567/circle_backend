const jwt = require('jsonwebtoken');
const axios = require('axios');
const User = require('../models/User');
const { encrypt } = require('../utils/erpCrypto');
const { callAttendanceApi, processAttendanceData } = require('./attendanceController');

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
    timeout: 25000,
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
    let erpAccessToken = null;
    let tokenData = null;
    let erpData = null;
    let erpAuthError = null;

    // 1. Try Authenticating with AKGEC ERP Token Endpoint
    // Determine candidate usernames to try:
    const candidateUsernames = [];
    if (identifier.includes('@')) {
      const localPart = identifier.split('@')[0].trim();
      const match = localPart.match(/\d+/);
      if (match) candidateUsernames.push(match[0]); // e.g. 2413200 from swastika2413200@akgec.ac.in
      candidateUsernames.push(localPart);
      candidateUsernames.push(identifier);
    } else {
      candidateUsernames.push(identifier);
    }

    // Try candidates sequentially
    for (const uName of candidateUsernames) {
      try {
        console.log(`[ERP Auth] Attempting Token generation for candidate: ${uName}`);
        const tokenResponse = await fetchErpToken(uName, password);
        const token = tokenResponse?.access_token || tokenResponse?.token;
        if (token) {
          erpAccessToken = token;
          tokenData = tokenResponse;
          erpSuccess = true;
          console.log(`[ERP Auth] Successfully authenticated with ERP as: ${uName}`);
          break;
        }
      } catch (err) {
        erpAuthError = err;
        console.warn(`[ERP Auth] Failed for candidate '${uName}':`, err.response?.data || err.message);
      }
    }

    // 2. If ERP Token was issued, the student is authentic!
    if (erpSuccess && erpAccessToken) {
      // Fetch /api/User profile details as non-blocking enhancement
      try {
        console.log('[ERP Auth] Fetching student profile details from /api/User...');
        erpData = await fetchErpUserData(erpAccessToken, tokenData);
        console.log('[ERP Auth] /api/User response received');
      } catch (profileErr) {
        console.warn('[ERP Auth Warning] /api/User fetch failed, proceeding with token details:', profileErr.message);
        erpData = null;
      }

      let profile = null;
      let deepDetails = {};
      const cleanId = identifier.trim().toLowerCase();
      const targetUserId = String(tokenData?.['X-UserId'] || tokenData?.userId || tokenData?.UserId || '').trim();

      if (erpData) {
        let rawList = erpData;
        if (rawList && rawList.data && Array.isArray(rawList.data)) rawList = rawList.data;
        if (!Array.isArray(rawList)) rawList = [rawList];

        // Priority 1: Match by exact ERP userId returned from /Token endpoint
        if (targetUserId) {
          profile = rawList.find((item) => item && String(item.userId || item.id || '').trim() === targetUserId);
        }

        // Priority 2: Match by admission number, roll number, or email
        if (!profile) {
          profile = rawList.find((item) => {
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
        if (!profile) {
          profile = rawList.find((item) => {
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

        if (!profile && rawList.length > 0) {
          profile = rawList[0];
        }

        if (profile && profile.userDetails) {
          try {
            deepDetails = typeof profile.userDetails === 'string' ? JSON.parse(profile.userDetails) : profile.userDetails;
          } catch (_) {}
        }
      }

      profile = profile || {};

      const fName = profile.firstName || deepDetails.firstName || '';
      const lName = profile.lastName || deepDetails.lastName || '';
      
      let admNo = (deepDetails.admissionNumber || profile.admissionNumber || deepDetails.admissionNo || profile.admissionNo || '').trim().toUpperCase();
      if (!admNo) {
        const numMatch = identifier.match(/\d+/);
        admNo = numMatch ? numMatch[0] : identifier.toUpperCase();
      }

      const uEmail = (deepDetails.email || profile.email || (identifier.includes('@') ? identifier.toLowerCase() : `${admNo.toLowerCase()}@akgec.ac.in`)).trim().toLowerCase();
      const fNameFull = `${fName} ${lName}`.trim() || profile.name || identifier;

      // Course
      let cCourse = deepDetails.selectedCourse || profile.courseName || deepDetails.courseTitle || profile.batchName?.split('(')[0] || 'B.Tech';
      if (/^B\.?TECH/i.test(cCourse)) cCourse = 'B.Tech';
      if (/^MCA/i.test(cCourse)) cCourse = 'MCA';

      // Semester
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

      // Branch
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

      // Find user by studentNo or email
      let user = await User.findOne({
        $or: [
          { studentNo: admNo },
          { email: uEmail },
          { studentNo: identifier.toUpperCase() },
          { email: identifier.toLowerCase() },
        ],
      });

      const finalErpUserId = String(targetUserId || profile.userId || deepDetails.userId || profile.id || user?.erpUserId || '').trim();

      if (!user) {
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
          erpUserId: finalErpUserId,
          erpPassword: encrypt(password),
          erpToken: erpAccessToken || '',
        });
      } else {
        if (fNameFull && fNameFull !== identifier) user.name = fNameFull;
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

        if (finalErpUserId) user.erpUserId = finalErpUserId;
        user.erpPassword = encrypt(password);
        if (erpAccessToken) user.erpToken = erpAccessToken;
      }

      // PRE-FETCH ATTENDANCE IMMEDIATELY ON LOGIN SO IT SHOWS DIRECTLY
      const syncUid = user.erpUserId || finalErpUserId;
      if (syncUid && erpAccessToken) {
        try {
          console.log(`[ERP Auth] Pre-fetching live attendance for UID ${syncUid}...`);
          const rawAtt = await callAttendanceApi(erpAccessToken, syncUid, tokenData);
          user.cachedAttendance = processAttendanceData(rawAtt);
          user.lastAttendanceSync = new Date();
          console.log('[ERP Auth] Live attendance successfully pre-fetched and saved!');
        } catch (attErr) {
          console.warn('[ERP Auth Warning] Pre-fetch attendance skipped:', attErr.message);
        }
      }

      await user.save();

      const token = generateToken(user._id);

      return res.status(200).json({
        success: true,
        message: 'AKGEC ERP verification successful! Logged in.',
        token,
        user: user.toCleanObject(),
        attendance: user.cachedAttendance || null,
      });
    }

    // 3. Fallback: Check local MongoDB credentials (for admins or previously registered users)
    const cleanId = identifier.trim().toLowerCase();
    const cleanNum = (identifier.match(/\d+/) || [''])[0];

    const orConditions = [
      { email: cleanId },
      { studentNo: identifier.trim().toUpperCase() },
    ];
    if (cleanNum) {
      orConditions.push({ studentNo: cleanNum });
      orConditions.push({ email: `${cleanNum}@akgec.ac.in` });
    }

    const user = await User.findOne({ $or: orConditions }).select('+password');

    if (user) {
      const isMatch = await user.comparePassword(password);
      if (isMatch) {
        const token = generateToken(user._id);
        return res.status(200).json({
          success: true,
          message: 'Logged in successfully',
          token,
          user: user.toCleanObject(),
        });
      }
    }

    // If both ERP and local DB match failed, provide clear user-friendly error
    if (erpAuthError && erpAuthError.response?.data) {
      const errData = erpAuthError.response.data;
      const desc = String(errData.error_description || errData.error || '');
      if (desc.includes('username or password is incorrect') || desc.includes('invalid_grant')) {
        return res.status(401).json({
          success: false,
          message: 'Invalid AKGEC ERP password or student number.',
        });
      }
    }

    if (erpAuthError && (erpAuthError.code === 'ECONNABORTED' || erpAuthError.message?.includes('timeout'))) {
      return res.status(504).json({
        success: false,
        message: 'AKGEC ERP server took too long to respond. Please try again.',
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid student number or ERP password.',
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

