const express = require('express');
const router  = express.Router();
const { query } = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Admin access required.' });
    }

    const result = await query(`
      SELECT user_id, username, email, full_name, role, phone_number,
             staff_id, nurse_number, clinic_name, clinic_number,
             is_active, created_at
      FROM users
      ORDER BY created_at DESC
    `);

    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching users' });
  }
});

router.put('/:id/status', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Admin access required.' });
    }

    const { is_active } = req.body;
    const result = await query(
      `UPDATE users SET is_active = $1 WHERE user_id = $2
       RETURNING user_id, username, is_active`,
      [is_active, req.params.id]
    );

    res.json({ success: true, message: 'User status updated', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating user' });
  }
});

router.put('/:id/reset-password', async (req, res) => {
    const userId = req.params.id;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        const result = await query(
            `UPDATE users SET password_hash = $1 WHERE user_id = $2 RETURNING user_id, email, full_name`,
            [hashedPassword, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, message: 'Password successfully reset.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error during password reset.' });
    }
});

module.exports = router;