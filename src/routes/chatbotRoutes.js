const express = require('express');
const router = express.Router();

const CHATBOT_API_URL = process.env.CHATBOT_API_URL || 'https://chatbot-xnwh.onrender.com/ask';

/**
 * @route   POST /api/chatbot/ask
 * @desc    Proxy query to external ML Chatbot API
 * @access  Public
 */
router.post('/ask', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Query is required and must be a non-empty string.',
      });
    }

    const response = await fetch(CHATBOT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: query.trim() }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'ML Chatbot API returned an error',
        error: data,
      });
    }

    return res.status(200).json({
      success: true,
      answer: data.answer,
      matched_facts: data.matched_facts || [],
      raw: data,
    });
  } catch (error) {
    console.error('[Chatbot Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to connect to ML Chatbot API',
      error: error.message,
    });
  }
});

module.exports = router;
