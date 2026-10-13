const crypto = require('crypto');

const getKey = () => {
  return crypto.createHash('sha256').update(String(process.env.JWT_SECRET || 'circle_erp_secret_key_2026')).digest();
};

const IV_LENGTH = 16;

const encrypt = (text) => {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', getKey(), iv);
    let encrypted = cipher.update(String(text), 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (e) {
    console.error('Encryption error:', e);
    return '';
  }
};

const decrypt = (text) => {
  if (!text || !text.includes(':')) return '';
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    console.error('Decryption error:', e);
    return '';
  }
};

module.exports = { encrypt, decrypt };
