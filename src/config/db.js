const mongoose = require('mongoose');
const dns = require('dns');

// Ensure reliable SRV DNS resolution for MongoDB Atlas on Windows
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {}

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`[MongoDB Connected]: ${conn.connection.host}`);
  } catch (error) {
    console.error(`[MongoDB Connection Error]: ${error.message}`);
    console.log('[Tip]: Ensure MongoDB is running locally or set MONGO_URI in .env to a MongoDB Atlas cluster URI.');
  }
};

module.exports = connectDB;
