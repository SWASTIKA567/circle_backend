const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./src/models/User');
const connectDB = require('./src/config/db');

dotenv.config();

const makeAdmin = async () => {
  try {
    await connectDB();
    const identifier = process.argv[2];

    if (!identifier) {
      console.log('Usage: node makeAdmin.js <email_or_studentNo>');
      console.log('Or running default seed for admin@circle.com...');
      
      const adminEmail = 'admin@circle.com';
      let adminUser = await User.findOne({ email: adminEmail }).select('+password');
      if (!adminUser) {
        adminUser = await User.create({
          name: 'System Admin',
          studentNo: 'ADMIN001',
          email: adminEmail,
          password: 'password123',
          isAdmin: true,
          role: 'admin',
          isSocietyMember: true,
        });
        console.log('Created new Admin user: admin@circle.com / password123 (StudentNo: ADMIN001)');
      } else {
        adminUser.isAdmin = true;
        adminUser.role = 'admin';
        await adminUser.save();
        console.log('Updated existing user admin@circle.com to Admin role.');
      }
      process.exit(0);
    }

    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase().trim() },
        { studentNo: identifier.toUpperCase().trim() },
      ],
    });

    if (!user) {
      console.error(`User with identifier "${identifier}" not found.`);
      process.exit(1);
    }

    user.isAdmin = true;
    user.role = 'admin';
    await user.save();

    console.log(`Success! User "${user.name}" (${user.email} / ${user.studentNo}) is now an Admin.`);
    process.exit(0);
  } catch (err) {
    console.error('Error making admin:', err);
    process.exit(1);
  }
};

makeAdmin();
