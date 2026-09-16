const mongoose = require('mongoose');

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
