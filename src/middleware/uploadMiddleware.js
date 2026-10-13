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

// File filter for image files (JPG, PNG, WEBP, GIF, SVG)
const imageFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext) || (file.mimetype && file.mimetype.startsWith('image/'))) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (.png, .jpg, .jpeg, .webp) are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB maximum size
  },
  fileFilter: fileFilter,
});

upload.image = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB maximum size
  },
  fileFilter: imageFilter,
});

module.exports = upload;
