const axios = require('axios');
const User = require('../models/User');
const { decrypt } = require('../utils/erpCrypto');

// Helper: Call AKGEC ERP Token API
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

  return response.data;
};

// Helper: Call Attendance API on AKGEC ERP
const callAttendanceApi = async (erpAccessToken, erpUserId) => {
  const url = `https://erp.akgec.ac.in/api/SubjectAttendance/GetPresentAbsentStudent?isDateWise=false&termId=0&userId=${erpUserId}&y=0`;
  
  const headers = {
    'Authorization': `Bearer ${erpAccessToken}`,
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'X-ContextId': '1',
    'ContextId': '1',
    'OrganizationId': '1',
    'organization_id': '1',
    'OrgId': '1',
    'orgId': '1',
    'X-UserId': String(erpUserId),
  };

  const response = await axios.get(url, { headers, timeout: 25000 });
  return response.data;
};

// Process & normalize raw ERP attendance records
const processAttendanceData = (rawData) => {
  let list = rawData;
  if (list && list.data && Array.isArray(list.data)) list = list.data;
  else if (list && list.table && Array.isArray(list.table)) list = list.table;
  else if (list && list.Table && Array.isArray(list.Table)) list = list.Table;
  else if (list && list.response && Array.isArray(list.response)) list = list.response;
  else if (!Array.isArray(list)) {
    if (typeof list === 'object' && list !== null) {
      // Find first array property
      const arrKey = Object.keys(list).find((k) => Array.isArray(list[k]));
      list = arrKey ? list[arrKey] : [list];
    } else {
      list = [];
    }
  }

  let totalHeldSum = 0;
  let totalAttendedSum = 0;
  let totalAbsentSum = 0;

  const subjects = list.map((item) => {
    const code = String(
      item.subjectCode || item.SubjectCode || item.code || item.Code || item.paperCode || item.PaperCode || ''
    ).trim();

    const name = String(
      item.subjectName ||
      item.SubjectName ||
      item.subject ||
      item.Subject ||
      item.subjectDescription ||
      item.SubjectDescription ||
      item.paperName ||
      item.PaperName ||
      code ||
      'Subject'
    ).trim();

    const teacher = String(item.facultyName || item.FacultyName || item.teacherName || item.TeacherName || '').trim();

    const total = Number(
      item.totalLecture ||
      item.TotalLecture ||
      item.totalClasses ||
      item.TotalClasses ||
      item.total ||
      item.Total ||
      item.held ||
      item.Held ||
      0
    );

    const present = Number(
      item.presentLecture ||
      item.PresentLecture ||
      item.present ||
      item.Present ||
      item.attended ||
      item.Attended ||
      0
    );

    const absent = Number(
      item.absentLecture ||
      item.AbsentLecture ||
      item.absent ||
      item.Absent ||
      (total >= present ? total - present : 0)
    );

    let percentage = 0;
    if (item.percentage !== undefined && item.percentage !== null && item.percentage !== '') {
      percentage = parseFloat(item.percentage);
    } else if (item.Percentage !== undefined && item.Percentage !== null && item.Percentage !== '') {
      percentage = parseFloat(item.Percentage);
    } else if (total > 0) {
      percentage = parseFloat(((present / total) * 100).toFixed(1));
    }

    if (isNaN(percentage)) percentage = 0;

    totalHeldSum += total;
    totalAttendedSum += present;
    totalAbsentSum += absent;

    // 75% attendance criteria rules
    const safeBunk = Math.max(0, Math.floor((4 * present - 3 * total) / 3));
    const requiredToAttend = Math.max(0, 3 * total - 4 * present);

    return {
      subjectCode: code,
      subjectName: name,
      facultyName: teacher,
      totalClasses: total,
      present,
      absent,
      percentage,
      safeBunk,
      requiredToAttend,
      status: percentage >= 75 ? 'safe' : percentage >= 65 ? 'warning' : 'critical',
    };
  });

  const overallPercentage = totalHeldSum > 0
    ? parseFloat(((totalAttendedSum / totalHeldSum) * 100).toFixed(1))
    : 0;

  const overallSafeBunk = Math.max(0, Math.floor((4 * totalAttendedSum - 3 * totalHeldSum) / 3));
  const overallRequiredToAttend = Math.max(0, 3 * totalHeldSum - 4 * totalAttendedSum);

  return {
    overallPercentage,
    totalHeld: totalHeldSum,
    totalPresent: totalAttendedSum,
    totalAbsent: totalAbsentSum,
    overallSafeBunk,
    overallRequiredToAttend,
    status: overallPercentage >= 75 ? 'safe' : overallPercentage >= 65 ? 'warning' : 'critical',
    subjects,
    lastSync: new Date().toISOString(),
  };
};

// @desc    Get student attendance directly from AKGEC ERP
// @route   GET /api/attendance
// @access  Protected
exports.getStudentAttendance = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+erpPassword +erpToken');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User account not found.',
      });
    }

    const erpUserId = user.erpUserId;
    const rawErpPassword = decrypt(user.erpPassword);

    // If user has no ERP credentials
    if (!erpUserId && !rawErpPassword) {
      return res.status(400).json({
        success: false,
        isErpLinked: false,
        message: 'AKGEC ERP credentials not linked. Please log in using your student number and password.',
      });
    }

    let erpAccessToken = user.erpToken;
    let attendanceData = null;
    let fetchError = null;

    // 1. Try using existing cached ERP access token
    if (erpAccessToken && erpUserId) {
      try {
        console.log(`[Attendance API] Attempting fetch with cached ERP token for user ${erpUserId}...`);
        const raw = await callAttendanceApi(erpAccessToken, erpUserId);
        attendanceData = processAttendanceData(raw);
      } catch (err) {
        console.warn('[Attendance API] Cached ERP token failed or expired, attempting renewal...');
        erpAccessToken = null;
      }
    }

    // 2. If token expired or was missing, renew via /Token
    if (!attendanceData && rawErpPassword) {
      try {
        const username = user.studentNo || user.admissionNo || user.email;
        console.log(`[Attendance API] Renewing ERP token for ${username}...`);
        const tokenRes = await fetchErpToken(username, rawErpPassword);
        erpAccessToken = tokenRes.access_token || tokenRes.token;

        const updatedUid = String(tokenRes['X-UserId'] || tokenRes.userId || erpUserId || '').trim();
        if (erpAccessToken) {
          user.erpToken = erpAccessToken;
          if (updatedUid) user.erpUserId = updatedUid;
          await user.save();

          console.log(`[Attendance API] Fetching attendance with new token for UID ${updatedUid}...`);
          const raw = await callAttendanceApi(erpAccessToken, updatedUid || erpUserId);
          attendanceData = processAttendanceData(raw);
        }
      } catch (renewErr) {
        console.error('[Attendance API] Failed to renew ERP token:', renewErr.response?.data || renewErr.message);
        fetchError = renewErr.message;
      }
    }

    // 3. Fallback to cached attendance if ERP is temporarily down
    if (!attendanceData && user.cachedAttendance) {
      console.log('[Attendance API] Returning cached attendance backup.');
      return res.status(200).json({
        success: true,
        isFromCache: true,
        attendance: user.cachedAttendance,
        message: 'ERP server temporarily unreachable. Showing last synced attendance.',
      });
    }

    if (!attendanceData) {
      return res.status(502).json({
        success: false,
        message: fetchError || 'Unable to retrieve attendance from AKGEC ERP at this moment. Please try again.',
      });
    }

    // Save latest data to user cache
    user.cachedAttendance = attendanceData;
    user.lastAttendanceSync = new Date();
    await user.save();

    return res.status(200).json({
      success: true,
      isFromCache: false,
      attendance: attendanceData,
    });
  } catch (error) {
    console.error('Attendance Controller Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching attendance.',
    });
  }
};
