# ⚙️ Circle Backend — Node.js & Express API

The backend server for **Circle**, powering student authentication, live AKGEC ERP attendance syncing, Cloudinary PDF notes storage, and society event management.

> 📱 **Mobile App Repository**: [circle](https://github.com/SWASTIKA567/circle)

---

## 🚀 Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start in development mode:
   ```bash
   npm run dev
   ```
3. The server runs at `http://localhost:5000`.

---

## 🛠 Tech Stack

- **Runtime**: Node.js & Express.js
- **Database**: MongoDB Atlas (Mongoose ODM)
- **File Storage**: Cloudinary (Multer Cloudinary storage)
- **Authentication**: JWT & bcryptjs
- **ERP Integration**: Axios & AES-256-CBC encrypted credential storage
- **Hosting**: Render
