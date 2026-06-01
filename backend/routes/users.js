// backend/routes/users.js

const express = require('express');
const router  = express.Router();
const { query } = require('../config/db');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

// GET ALL USERS (
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
    console.error('Error fetching users:', err);
    res.status(500).json({ success: false, message: 'Server error fetching users' });
  }
});

// TOGGLE USER STATUS
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
    console.error('Error updating user status:', err);
    res.status(500).json({ success: false, message: 'Server error updating user' });
  }
});

module.exports = router;