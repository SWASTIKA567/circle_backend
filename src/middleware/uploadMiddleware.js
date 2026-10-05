const multer = require('multer');
const path = require('path');

// Memory storage keeps file buffer in memory so we can stream/upload directly to Cloudinary
const storage = multer.memoryStorage();

// File filter to only allow PDF files
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.pdf' || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files (.pdf) are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB maximum size
  },
  fileFilter: fileFilter,
});

module.exports = upload;
