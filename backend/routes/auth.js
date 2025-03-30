const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Review = require('../models/Review');
const HousehelpReview = require('../models/HousehelpReview');
const nodemailer = require('nodemailer');
const authenticate = require('../middleware/authenticate'); // Middleware to authenticate user

const router = express.Router();

// ✅ Import `sendUpdate` After Exporting Routes
let sendUpdate;
setTimeout(() => {
    sendUpdate = require("../server").sendUpdate;
}, 1000);

router.post('/signup', async (req, res) => {
  const { fullname, email, password, phone, gender, userType, location } = req.body;

  try {
    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists. Please sign in." });
    }

    // Hash password and create new user
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ fullname, email, password: hashedPassword, phone, gender, userType, location });
    await user.save();

    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sign-In
router.post('/signin', async (req, res) => {
  try {
      const { email, password } = req.body;

      // ✅ Find user by email or phone
      const user = await User.findOne({ email });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      // ✅ Check if account is frozen
      if (user.accountStatus === 'frozen') {
          return res.status(403).json({ error: 'Your account has been frozen due to violations. Please contact support.' });
      }

      // ✅ Check password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

      // ✅ Generate JWT token
      const token = jwt.sign({ userId: user._id, userType: user.userType }, process.env.JWT_SECRET, { expiresIn: '7d' });

      res.json({ 
          message: 'Login successful',
          token,
          userType: user.userType,
          userId: user._id 
      });

  } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


// Get employer profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
      fullname: user.fullname,
      idNumber: user.idNumber,
      email: user.email,
      nationality: user.nationality,
      religion: user.religion,
      maritalStatus: user.maritalStatus,
      age: user.age,
      dob: user.dob,
      healthIssues: user.healthIssues,
      profilePhoto: user.profilePhoto
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Update employer profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user._id; // Ensure `req.user.id` is correct

    // 🔍 Log request body to check received data
    console.log("Update Request Body:", req.body);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      req.body,
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log("Updated User Data:", updatedUser); // ✅ Log updated data

    res.json({ message: "Profile updated successfully", user: updatedUser });

  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
router.get('/status', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ verified: user.verificationStatus });
  } catch (error) {
    console.error('Error checking verification:', error);
    res.status(500).json({ message: 'Error checking verification' });
  }
});
// Update profile photo
router.put('/profile/photo', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.profilePhoto = req.body.profilePhoto; // Save base64 image
    await user.save();

    res.json({ message: "Profile photo updated successfully", profilePhoto: user.profilePhoto });
  } catch (error) {
    console.error("Error updating profile photo:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


// ✅ Users can submit verification details, but verificationStatus stays false
router.post('/verify', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // ✅ Update user verification details
    user.faceScan = req.body.faceScan;
    user.idFront = req.body.idFront;
    user.idBack = req.body.idBack;
    user.verificationStatus = false; // ✅ User remains unverified until admin approval
    user.verificationSubmitted = true; // ✅ New flag to track submission status

    // ✅ Reset rejection reason if user was previously rejected
    if (user.rejectionReason) {
      user.rejectionReason = null;
      console.log(`🔄 User ${user.fullname} is reapplying for verification.`);
    }

    await user.save();

    res.json({ message: 'Verification submitted successfully. Awaiting admin approval.' });
  } catch (error) {
    console.error('❌ Error submitting verification:', error);
    res.status(500).json({ message: 'Error submitting verification' });
  }
});

//Get househelp profile
router.get('/househelp/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user || user.userType !== 'househelp') {
      return res.status(404).json({ message: 'Househelp profile not found' });
    }

    res.json({
      fullname: user.fullname,
      idNumber: user.idNumber,
      email:user.email,
      nationality: user.nationality,
      religion: user.religion,
      maritalStatus: user.maritalStatus,
      age: user.age,
      dob: user.dob,
      healthIssues: user.healthIssues,
      skills: user.skills || [],
      experience: user.experience || "",
      profilePhoto: user.profilePhoto
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update househelp profile photo
router.put('/househelp/profile', authenticate, async (req, res) => {
  try {
      const user = await User.findById(req.user._id);
      if (!user || user.userType !== 'househelp') {
          return res.status(404).json({ message: 'Househelp profile not found' });
      }

      // ✅ Update only the provided fields
      user.fullname = req.body.fullname || user.fullname;
      user.idNumber = req.body.idNumber || user.idNumber;
      user.nationality = req.body.nationality || user.nationality;
      user.religion = req.body.religion || user.religion;
      user.maritalStatus = req.body.maritalStatus || user.maritalStatus;
      user.age = req.body.age || user.age;
      user.dob = req.body.dob || user.dob;
      user.healthIssues = req.body.healthIssues || user.healthIssues;
      user.skills = req.body.skills ? req.body.skills.split(',').map(skill => skill.trim()) : user.skills;
      user.experience = req.body.experience || user.experience;

      await user.save();

      res.json({ message: 'Profile updated successfully', user });

  } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({ message: 'Server error' });
  }
});

// Update profile photo route
router.put('/househelp/profile/photo', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.userType !== 'househelp') {
      return res.status(404).json({ message: "Househelp profile not found" });
    }

    // Save the profile photo
    user.profilePhoto = req.body.profilePhoto;
    await user.save();

    res.json({ 
      message: "Profile photo updated successfully", 
      profilePhoto: user.profilePhoto 
    });

  } catch (error) {
    console.error("Error updating profile photo:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


// Update househelp profile
router.get('/househelp/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user || user.userType !== 'househelp') {
      return res.status(404).json({ message: 'Househelp profile not found' });
    }

    res.json({
      fullname: user.fullname,
      email: user.email, // ✅ Ensure email is included
      idNumber: user.idNumber,
      nationality: user.nationality,
      religion: user.religion,
      maritalStatus: user.maritalStatus,
      age: user.age,
      dob: user.dob,
      healthIssues: user.healthIssues,
      skills: user.skills || [],
      experience: user.experience || "",
      profilePhoto: user.profilePhoto
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


// Get househelp verification status
router.get('/househelp/status', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.userType !== 'househelp') {
      return res.status(404).json({ message: 'Househelp not found' });
    }
    res.json({ verified: user.verificationStatus });
  } catch (error) {
    console.error('Error fetching verification status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ VERIFY Househelp
router.post('/househelp/verify', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.userType !== 'househelp') {
      return res.status(404).json({ message: 'Househelp not found' });
    }

    user.verificationStatus = true;
    user.faceScan = req.body.faceScan;
    user.idFront = req.body.idFront;
    user.idBack = req.body.idBack;

    user.verificationStatus = false; // ✅ Keep them unverified until admin approval
    user.verificationSubmitted = true; // ✅ Track that verification was submitted
    await user.save();

    res.json({ message: 'Verification successful', verified: true });
  } catch (error) {
    console.error('verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/househelp/verification', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.userType !== 'househelp') {
      return res.status(404).json({ message: 'Househelp not found' });
    }

    // ✅ Save Base64 images
    user.faceScan = req.body.faceScan;
    user.idFront = req.body.idFront;
    user.idBack = req.body.idBack;

    user.verificationStatus = false; // ✅ User remains unverified
    user.verificationSubmitted = true; // ✅ Track that verification was submitted
    await user.save();

    res.json({ message: 'Verification successful', verified: true });
  } catch (error) {
    console.error('Error verifying househelp:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
router.post('/:id/apply', authenticate, async (req, res) => {
  try {
    if (req.user.userType !== 'househelp') {
      return res.status(403).json({ message: 'Only househelps can apply for jobs' });
    }
    if (!req.user.verificationStatus) {
      return res.status(403).json({ message: 'You must be verified to apply for a job' });
    }

    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // ✅ Prevent undefined error
    if (!job.applications) {
      job.applications = [];
    }

    // ✅ Prevent duplicate applications
    if (job.applications.some(app => app.userId.toString() === req.user._id.toString())) {
      return res.status(400).json({ message: 'You have already applied for this job' });
    }

    const applicantDetails = {
      userId: req.user._id,
      name: req.user.fullname,
      age: req.user.age,
      phone: req.user.phone
    };

    job.applications.push(applicantDetails);
    await job.save();

    res.status(200).json({ message: 'Application submitted successfully' });
  } catch (error) {
    console.error('Error applying for job:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.get('/househelps/available', authenticate, async (req, res) => {
  try {
    // Find all users where userType is 'househelp'
    const househelps = await User.find({ userType: "househelp" });

    if (!househelps.length) {
      return res.status(404).json({ message: 'No househelps found' });
    }

    res.status(200).json(househelps);
  } catch (error) {
    console.error('Error fetching househelps:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/employers/available', authenticate, async (req, res) => {
  try {
    // Find all users where userType is 'employer'
    const employers = await User.find({ userType: "employer" });

    if (!employers.length) {
      return res.status(404).json({ message: 'No employers found' });
    }

    res.status(200).json(employers);
  } catch (error) {
    console.error('Error fetching employers:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Route to view reviews for a user (employer or househelp)
router.get('/:userId/reviews', authenticate, async (req, res) => {
  try {
    const userId = req.params.userId;

    // Validate the userId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    // Find the user and populate their reviews
    const user = await User.findById(userId).populate({
      path: 'reviews',
      populate: {
        path: 'reviewer',
        select: 'fullname' // Only fetch the reviewer's fullname
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Send the reviews as a response
    res.status(200).json({
      fullname: user.fullname,
      reviews: user.reviews,
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ message: 'Error fetching reviews', error: error.message });
  }
});

// Route to add a review for a user (employer or househelp)
router.post('/:userId/reviews', authenticate, async (req, res) => {
  try {
    const userId = req.params.userId;
    const { rating, comment } = req.body;
    const reviewerId = req.user._id; // Assuming the authenticated user is the reviewer

    // Validate the rating
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    // Create a new review
    const review = new Review({
      rating,
      comment,
      employer: userId, // The user being reviewed
      reviewer: reviewerId, // The user who wrote the review
    });

    // Save the review
    await review.save();

    // Add the review to the user's reviews array
    const user = await User.findById(userId);
    user.reviews.push(review._id);

    // Recalculate the user's average rating
    const reviews = await Review.find({ employer: userId });
    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    user.averageRating = totalRating / reviews.length;

    // Save the updated user
    await user.save();

    // Send a success response
    res.status(201).json({ message: 'Review added successfully', review });
  } catch (error) {
    console.error('Error adding review:', error);
    res.status(500).json({ message: 'Error adding review', error: error.message });
  }
});

// POST /api/househelps/:househelpId/reviews
router.post('/househelps/:househelpId/reviews', authenticate, async (req, res) => {
  try {
    const househelpId = req.params.househelpId;
    const { rating, comment } = req.body;
    const reviewerId = req.user._id; // Assuming the authenticated user is the reviewer

    // Validate the rating
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    // Create a new review
    const review = new HousehelpReview({
      rating,
      comment,
      househelp: househelpId, // The househelp being reviewed
      reviewer: reviewerId, // The user who wrote the review
    });

    // Save the review
    await review.save();

    // Add the review to the househelp's reviews array
    const househelp = await User.findById(househelpId);
    househelp.reviews.push(review._id);

    // Recalculate the househelp's average rating
    const reviews = await HousehelpReview.find({ househelp: househelpId });
    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    househelp.averageRating = totalRating / reviews.length;

    // Save the updated househelp
    await househelp.save();

    // Send a success response
    res.status(201).json({ message: 'Review added successfully', review });
  } catch (error) {
    console.error('Error adding review:', error);
    res.status(500).json({ message: 'Error adding review', error: error.message });
  }
});

// GET /api/househelps/:househelpId/reviews
router.get('/househelps/:househelpId/reviews', authenticate, async (req, res) => {
  try {
    const househelpId = req.params.househelpId;

    // Validate the househelpId
    if (!mongoose.Types.ObjectId.isValid(househelpId)) {
      return res.status(400).json({ message: 'Invalid househelp ID' });
    }

    // Find all reviews for the househelp
    const reviews = await HousehelpReview.find({ househelp: househelpId })
      .populate('reviewer', 'fullname'); // Populate reviewer details

    res.status(200).json({ reviews });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ message: 'Error fetching reviews', error: error.message });
  }
});
// 🌟 Email Transporter Configuration (Replace with actual credentials)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your email
    pass: process.env.EMAIL_PASS  // Your email password or app password
  }
});
console.log("📧 EMAIL_USER:", process.env.EMAIL_USER);
console.log("🔑 EMAIL_PASS:", process.env.EMAIL_PASS ? "Exists" : "Missing");

// 🌟 Forgot Password Endpoint (Generate Reset Token & Send Email)
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate a reset token (valid for 1 hour)
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Send password reset email
    const resetLink = `http://127.0.0.1:5500/frontend/reset-password.html?token=${token}`;


    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request',
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password.</p>`
    });

    res.json({ message: 'Password reset link sent to your email.' });
  } catch (error) {
    console.error('Error sending password reset email:', error);
    res.status(500).json({ message: 'Error processing request.' });
  }
});

// 🌟 Reset Password Endpoint
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: 'Invalid or expired token.' });
    }

    // Hash new password and save
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(400).json({ message: 'Invalid or expired token.' });
  }
});

module.exports = router;