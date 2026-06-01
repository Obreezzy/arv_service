
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { query } = require('../config/db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();


// HELPERS

const generateStaffId = async () => {
  const result = await query(`
    SELECT COALESCE(MAX(
      CAST(REGEXP_REPLACE(staff_id, '[^0-9]', '', 'g') AS INTEGER)
    ), 0) AS max_num
    FROM users
    WHERE staff_id IS NOT NULL
  `);
  const next = parseInt(result.rows[0].max_num) + 1;
  return 'STF-' + String(next).padStart(3, '0');
};

const generateNurseNumber = async () => {
  const result = await query(`
    SELECT COALESCE(MAX(
      CAST(REGEXP_REPLACE(nurse_number, '[^0-9]', '', 'g') AS INTEGER)
    ), 100) AS max_num
    FROM users
    WHERE nurse_number IS NOT NULL
  `);
  const next = parseInt(result.rows[0].max_num) + 1;
  return 'NRS-' + String(next).padStart(3, '0');
};

// ============================================
// REGISTER NEW USER
// ============================================

router.post('/register', async (req, res) => {
  try {
    const {
      username, email, password, full_name, role,
      phone_number, clinic_name, clinic_number
    } = req.body;

    console.log('Registration attempt:', { username, email, role });

    
    if (!username || !email || !password || !full_name || !role) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: Full Name, Username, Email, Password and Role.'
      });
    }

    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address (e.g. name@clinic.com).'
      });
    }

    
    const validRoles = ['admin', 'healthcare_worker', 'data_entry'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role selected. Must be Healthcare Worker, Data Entry, or Administrator.'
      });
    }

    if (role !== 'admin' && !clinic_number) {
      return res.status(400).json({
        success: false,
        message: 'Clinic Number is required for nurses and data entry staff.'
      });
    }
    if (role !== 'admin' && !clinic_name) {
      return res.status(400).json({
        success: false,
        message: 'Clinic Name is required for nurses and data entry staff.'
      });
    }

    const usernameCheck = await query(
      'SELECT user_id FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    if (usernameCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Username "' + username + '" is already taken. Please choose a different username.'
      });
    }

    const emailCheck = await query(
      'SELECT user_id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with email "' + email + '" already exists. Please use a different email or contact the administrator.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    
    const salt          = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const staff_id     = await generateStaffId();
    const nurse_number = role === 'healthcare_worker' ? await generateNurseNumber() : null;

    console.log('Generated Staff ID:', staff_id, nurse_number ? '| Nurse No: ' + nurse_number : '');

    // Insert 
    const result = await query(
      `INSERT INTO users (
          username, email, password_hash, full_name, role, phone_number,
          is_active, staff_id, nurse_number, clinic_name, clinic_number
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING user_id, username, email, full_name, role, phone_number,
                 staff_id, nurse_number, clinic_name, clinic_number, created_at`,
      [
        username, email, password_hash, full_name, role,
        phone_number  || null,
        true,
        staff_id,
        nurse_number,
        clinic_name   || null,
        clinic_number || null
      ]
    );

    const newUser = result.rows[0];
    console.log('User created successfully:', newUser.user_id, '| Staff ID:', staff_id);

    res.status(201).json({
      success: true,
      message: full_name + ' has been registered successfully with Staff ID: ' + staff_id +
        (nurse_number ? ' and Nurse Number: ' + nurse_number : '') + '.',
      user: {
        user_id:       newUser.user_id,
        username:      newUser.username,
        email:         newUser.email,
        full_name:     newUser.full_name,
        role:          newUser.role,
        phone_number:  newUser.phone_number,
        staff_id:      newUser.staff_id,
        nurse_number:  newUser.nurse_number,
        clinic_name:   newUser.clinic_name,
        clinic_number: newUser.clinic_number,
        created_at:    newUser.created_at
      }
    });

  } catch (error) {
    console.error(' Registration error:', error);

   
    if (error.code === '23505') {
      const detail = error.detail || '';
      if (detail.includes('staff_id')) {
        return res.status(409).json({
          success: false,
          message: 'Staff ID conflict detected. Please try again — the system will generate a new ID.'
        });
      }
      if (detail.includes('nurse_number')) {
        return res.status(409).json({
          success: false,
          message: 'Nurse Number conflict detected. Please try again — the system will generate a new number.'
        });
      }
      if (detail.includes('username')) {
        return res.status(409).json({
          success: false,
          message: 'That username is already taken. Please choose another.'
        });
      }
      if (detail.includes('email')) {
        return res.status(409).json({
          success: false,
          message: 'That email address is already registered.'
        });
      }
    }

    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while creating the account. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// LOGIN USER

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt:', email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please enter both your email address and password.'
      });
    }

    const result = await query(
      `SELECT user_id, username, email, password_hash, full_name, role,
              phone_number, is_active, staff_id, nurse_number,
              clinic_name, clinic_number, created_at
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'No account found with that email address. Please check and try again.'
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact the system administrator.'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect password. Please try again.'
      });
    }

    const payload = {
      user_id:       user.user_id,
      username:      user.username,
      email:         user.email,
      role:          user.role,
      staff_id:      user.staff_id,
      nurse_number:  user.nurse_number  || null,
      clinic_name:   user.clinic_name   || null,
      clinic_number: user.clinic_number || null
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    });

    console.log('JWT generated for:', email, '| Role:', user.role);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        user_id:       user.user_id,
        username:      user.username,
        email:         user.email,
        full_name:     user.full_name,
        role:          user.role,
        phone_number:  user.phone_number,
        staff_id:      user.staff_id,
        nurse_number:  user.nurse_number  || null,
        clinic_name:   user.clinic_name   || null,
        clinic_number: user.clinic_number || null,
        created_at:    user.created_at
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// GET CURRENT USER (PROTECTED)

router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT user_id, username, email, full_name, role,
              phone_number, is_active, staff_id, nurse_number,
              clinic_name, clinic_number, created_at
       FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User account not found. Please log in again.'
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        user_id:       user.user_id,
        username:      user.username,
        email:         user.email,
        full_name:     user.full_name,
        role:          user.role,
        phone_number:  user.phone_number,
        is_active:     user.is_active,
        staff_id:      user.staff_id,
        nurse_number:  user.nurse_number  || null,
        clinic_name:   user.clinic_name   || null,
        clinic_number: user.clinic_number || null,
        created_at:    user.created_at
      }
    });

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      message: 'Could not load user profile. Please try again.'
    });
  }
});

module.exports = router;