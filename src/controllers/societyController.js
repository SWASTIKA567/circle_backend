const fs = require('fs');
const path = require('path');
const Society = require('../models/Society');
const cloudinary = require('../config/cloudinary');

// Helper to upload image buffer to Cloudinary
const uploadBufferToCloudinaryImage = (fileBuffer, originalName) => {
  return new Promise((resolve, reject) => {
    const cleanName = (originalName || 'logo').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        folder: 'circle_societies/logos',
        public_id: `${Date.now()}_${cleanName}`,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};

// @desc    Upload society logo image
// @route   POST /api/societies/upload-logo
// @access  Protected
exports.uploadSocietyLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an image file for the society logo.',
      });
    }

    let logoUrl = '';
    const hasCloudinary = Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET &&
      process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name'
    );

    if (hasCloudinary && req.file.buffer) {
      try {
        const uploadResult = await uploadBufferToCloudinaryImage(req.file.buffer, req.file.originalname);
        logoUrl = uploadResult.secure_url || uploadResult.url;
      } catch (cloudErr) {
        console.warn('Cloudinary logo upload failed (e.g. invalid cloud_name), falling back to local storage:', cloudErr.message || cloudErr);
      }
    }

    if (!logoUrl) {
      const logosDir = path.join(__dirname, '../../uploads/logos');
      if (!fs.existsSync(logosDir)) {
        fs.mkdirSync(logosDir, { recursive: true });
      }
      const ext = path.extname(req.file.originalname) || '.png';
      const cleanName = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeName = `${Date.now()}_${cleanName}${ext}`;
      const filePath = path.join(logosDir, safeName);

      if (req.file.buffer) {
        fs.writeFileSync(filePath, req.file.buffer);
      } else if (req.file.path && fs.existsSync(req.file.path)) {
        fs.copyFileSync(req.file.path, filePath);
      } else {
        throw new Error('Image storage configuration error. Missing buffer or file path.');
      }
      logoUrl = `/uploads/logos/${safeName}`;
    }

    return res.status(200).json({
      success: true,
      message: 'Society logo uploaded successfully!',
      logoUrl,
    });
  } catch (error) {
    console.error('Error uploading society logo:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while uploading logo.',
    });
  }
};

// @desc    Create a new society
// @route   POST /api/societies
// @access  Protected
exports.createSociety = async (req, res) => {
  try {
    // 1. Role verification: user must be logged in
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Please log in to create a society.',
      });
    }

    const {
      name,
      department,
      description,
      societyPassword,
      logoUrl,
      websiteLink,
      registrationLink,
      domains,
      recentEvents,
      upcomingEvents,
      category,
    } = req.body;

    // 2. Validate mandatory fields
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Society name is mandatory.' });
    }
    if (!department || !department.trim()) {
      return res.status(400).json({ success: false, message: 'Department is mandatory.' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Description is mandatory.' });
    }
    if (!societyPassword || societyPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Society password is mandatory and must be at least 4 characters long.',
      });
    }

    // 3. Check for existing society with the same name
    const existing = await Society.findOne({ name: new RegExp(`^${name.trim()}$`, 'i') });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A society named "${name.trim()}" already exists.`,
      });
    }

    // 4. Process domains (supports array or comma-separated string)
    let processedDomains = [];
    if (Array.isArray(domains)) {
      processedDomains = domains.map((d) => d.toString().trim()).filter(Boolean);
    } else if (typeof domains === 'string' && domains.trim().length > 0) {
      processedDomains = domains.split(',').map((d) => d.trim()).filter(Boolean);
    }

    // 5. Create society
    const newSociety = await Society.create({
      name: name.trim(),
      department: department.trim(),
      description: description.trim(),
      societyPassword,
      logoUrl: logoUrl ? logoUrl.trim() : '',
      websiteLink: websiteLink ? websiteLink.trim() : '',
      registrationLink: registrationLink ? registrationLink.trim() : '',
      domains: processedDomains,
      recentEvents: Array.isArray(recentEvents) ? recentEvents : [],
      upcomingEvents: Array.isArray(upcomingEvents) ? upcomingEvents : [],
      category: category || 'Technical',
      status: 'pending',
      isApproved: false,
      createdBy: req.user._id,
      createdByName: req.user.name || 'Society Member',
    });

    if (req.user && !req.user.isSocietyMember) {
      try {
        req.user.isSocietyMember = true;
        await req.user.save();
      } catch (saveErr) {
        console.warn('Could not update user isSocietyMember flag:', saveErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Society created successfully! It is submitted for Admin approval.',
      society: {
        id: newSociety._id,
        name: newSociety.name,
        department: newSociety.department,
        description: newSociety.description,
        logoUrl: newSociety.logoUrl,
        websiteLink: newSociety.websiteLink,
        registrationLink: newSociety.registrationLink,
        domains: newSociety.domains,
        recentEvents: newSociety.recentEvents,
        upcomingEvents: newSociety.upcomingEvents,
        category: newSociety.category,
        status: newSociety.status,
        isApproved: newSociety.isApproved,
        createdByName: newSociety.createdByName,
        createdAt: newSociety.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating society:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while creating society.',
    });
  }
};

// @desc    Get all societies (Public for all students - ONLY approved)
// @route   GET /api/societies
// @access  Public
exports.getAllSocieties = async (req, res) => {
  try {
    const { search, category, department } = req.query;
    let filter = {
      $or: [
        { status: 'approved' },
        { isApproved: true },
      ],
    };

    if (category && category !== 'All') {
      filter.category = { $regex: new RegExp(`^${category}$`, 'i') };
    }

    if (department && department !== 'All') {
      filter.department = { $regex: new RegExp(`^${department}$`, 'i') };
    }

    if (search && search.trim().length > 0) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$and = [
        {
          $or: [
            { status: 'approved' },
            { isApproved: true },
          ],
        },
        {
          $or: [
            { name: searchRegex },
            { department: searchRegex },
            { description: searchRegex },
            { domains: searchRegex },
          ],
        },
      ];
      delete filter.$or;
    }

    const societies = await Society.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: societies.length,
      societies,
    });
  } catch (error) {
    console.error('Error fetching societies:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch societies.',
    });
  }
};

// @desc    Get all pending societies for Admin review
// @route   GET /api/admin/pending-societies
// @access  Admin
exports.getPendingSocieties = async (req, res) => {
  try {
    const pendingSocieties = await Society.find({
      $or: [
        { status: 'pending' },
        { isApproved: false, status: { $ne: 'rejected' } },
      ],
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: pendingSocieties.length,
      societies: pendingSocieties,
    });
  } catch (error) {
    console.error('Error fetching pending societies:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pending societies.',
    });
  }
};

// @desc    Approve a pending society
// @route   PUT /api/admin/societies/:id/approve
// @access  Admin
exports.approveSociety = async (req, res) => {
  try {
    const society = await Society.findById(req.params.id);

    if (!society) {
      return res.status(404).json({
        success: false,
        message: 'Society not found.',
      });
    }

    society.status = 'approved';
    society.isApproved = true;
    society.approvedAt = new Date();
    society.approvedBy = req.user ? req.user._id : null;

    await society.save();

    return res.status(200).json({
      success: true,
      message: `Society "${society.name}" approved successfully!`,
      society,
    });
  } catch (error) {
    console.error('Error approving society:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to approve society.',
    });
  }
};

// @desc    Reject / delete a society
// @route   DELETE /api/admin/societies/:id/reject
// @access  Admin
exports.rejectSociety = async (req, res) => {
  try {
    const society = await Society.findById(req.params.id);

    if (!society) {
      return res.status(404).json({
        success: false,
        message: 'Society not found.',
      });
    }

    await society.deleteOne();

    return res.status(200).json({
      success: true,
      message: `Society "${society.name}" rejected and removed.`,
    });
  } catch (error) {
    console.error('Error rejecting society:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reject society.',
    });
  }
};

// @desc    Get single society by ID
// @route   GET /api/societies/:id
// @access  Public
exports.getSocietyById = async (req, res) => {
  try {
    const society = await Society.findById(req.params.id);
    if (!society) {
      return res.status(404).json({ success: false, message: 'Society not found.' });
    }

    return res.status(200).json({
      success: true,
      society,
    });
  } catch (error) {
    console.error('Error fetching society:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch society details.',
    });
  }
};

// @desc    Verify society password (before opening edit form)
// @route   POST /api/societies/:id/verify-password
// @access  Protected (Society Members Only)
exports.verifySocietyPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide the society password.',
      });
    }

    const society = await Society.findById(req.params.id).select('+societyPassword');
    if (!society) {
      return res.status(404).json({ success: false, message: 'Society not found.' });
    }

    const isMatch = await society.compareSocietyPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid society password. Only members of this society can edit information.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Society password verified successfully.',
    });
  } catch (error) {
    console.error('Error verifying society password:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify society password.',
    });
  }
};

// @desc    Update society details (Protected with Society Password)
// @route   PUT /api/societies/:id
// @access  Protected (Society Members Only with Society Password)
exports.updateSociety = async (req, res) => {
  try {
    const {
      societyPassword,
      name,
      department,
      description,
      logoUrl,
      websiteLink,
      registrationLink,
      domains,
      recentEvents,
      upcomingEvents,
      category,
      newSocietyPassword,
    } = req.body;

    if (!societyPassword) {
      return res.status(400).json({
        success: false,
        message: 'Society password is required to edit society information.',
      });
    }

    // Find society with its password
    const society = await Society.findById(req.params.id).select('+societyPassword');
    if (!society) {
      return res.status(404).json({ success: false, message: 'Society not found.' });
    }

    // Verify society password
    const isMatch = await society.compareSocietyPassword(societyPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid society password. Only authorized members of this society can edit.',
      });
    }

    // Apply updates
    if (name && name.trim()) society.name = name.trim();
    if (department && department.trim()) society.department = department.trim();
    if (description && description.trim()) society.description = description.trim();
    if (logoUrl !== undefined) society.logoUrl = logoUrl.trim();
    if (websiteLink !== undefined) society.websiteLink = websiteLink.trim();
    if (registrationLink !== undefined) society.registrationLink = registrationLink.trim();
    if (category) society.category = category;

    if (domains !== undefined) {
      if (Array.isArray(domains)) {
        society.domains = domains.map((d) => d.toString().trim()).filter(Boolean);
      } else if (typeof domains === 'string') {
        society.domains = domains.split(',').map((d) => d.trim()).filter(Boolean);
      }
    }

    if (recentEvents !== undefined && Array.isArray(recentEvents)) {
      society.recentEvents = recentEvents;
    }

    if (upcomingEvents !== undefined && Array.isArray(upcomingEvents)) {
      society.upcomingEvents = upcomingEvents;
    }

    // Update password if new password provided
    if (newSocietyPassword && newSocietyPassword.length >= 4) {
      society.societyPassword = newSocietyPassword;
    }

    await society.save();

    // Return updated society without password
    const updated = await Society.findById(society._id);

    return res.status(200).json({
      success: true,
      message: 'Society updated successfully!',
      society: updated,
    });
  } catch (error) {
    console.error('Error updating society:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while updating society.',
    });
  }
};
