const express = require("express");
const router = express.Router();
const Admin = require("../models/Admin");
const User = require("../models/User");
const Job = require("../models/Job");
const Blacklist = require("../models/Blacklist");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const AuditLog = require("../models/AuditLog");
const authenticateAdmin = require("../middleware/authenticateAdmin"); // Middleware to authenticate admin

// Configure email sender
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // Your email
    pass: process.env.EMAIL_PASS, // App password
  },
});

// ✅ Import `sendUpdate` After Exporting Routes
let sendUpdate;
setTimeout(() => {
  sendUpdate = require("../server").sendUpdate;
}, 1000);

// const loginLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 50, // Allow only 50 attempts per IP
//   message: { error: "Too many login attempts. Try again later." },
// });
// Admin Sign-Up (Only for initial setup)

router.post("/signup", async (req, res) => {
  const { fullname, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "1d" });

    const admin = new Admin({ fullname, email, password: hashedPassword, isVerified: false, verificationToken });
    await admin.save();

    const verificationLink = `http://localhost:5000/api/admin/verify/${verificationToken}`;
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Verify Your Admin Account",
      html: `<p>Click <a href="${verificationLink}">here</a> to verify your account.</p>`,
    });

    res.status(201).json({ message: "Admin created successfully. Please verify your email." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Email Verification Route
router.get("/verify/:token", async (req, res) => {
  try {
    const { email } = jwt.verify(req.params.token, process.env.JWT_SECRET);
    const admin = await Admin.findOneAndUpdate({ email }, { isVerified: true });

    if (!admin) return res.status(404).json({ message: "Admin not found" });

    res.send("Email verified. You can now log in.");
  } catch (error) {
    res.status(400).json({ error: "Invalid or expired token." });
  }
});
// Admin Sign-In
router.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  try {
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ error: "Admin not found" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { adminId: admin._id, fullname: admin.fullname },  // Include fullname in JWT
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ token, fullname: admin.fullname });  // Send name in response
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/househelps", authenticateAdmin, async (req, res) => {
  try {
      const { search } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const skip = (page - 1) * limit;

      let query = { userType: "househelp" };

      // ✅ Search by Name, Email, or Location
      if (search) {
          query.$or = [
              { fullname: { $regex: search, $options: "i" } },
              { email: { $regex: search, $options: "i" } },
              { location: { $regex: search, $options: "i" } }
          ];
      }

      const totalHousehelps = await User.countDocuments(query);
      const househelps = await User.find(query, "fullname email location accountStatus")
          .skip(skip)
          .limit(limit);

      res.json({
          househelps,
          totalPages: Math.ceil(totalHousehelps / limit),
          currentPage: page
      });

  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});


// ✅ Freeze Househelp Account and Notify via Email
router.put("/househelps/:id/freeze", authenticateAdmin, async (req, res) => {
  try {
    const househelp = await User.findById(req.params.id);
    if (!househelp) return res.status(404).json({ message: "Househelp not found" });

    househelp.accountStatus = "frozen";
    househelp.frozenUntil = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000); // Freeze for 6 months
    await househelp.save();

    // ✅ Log the action in AuditLog
    await AuditLog.create({
      admin: req.admin._id,
      action: `Froze Househelp Account: ${househelp.fullname} (${househelp.email})`,
      targetUser: househelp._id,
    });

    // ✅ Send real-time update
    sendUpdate("househelpUpdated", { id: househelp._id, status: "frozen" });

    // ✅ Send Email Notification to the Frozen Househelp
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: househelp.email,
      subject: "Account Frozen ❄️",
      text: `Dear ${househelp.fullname},\n\nYour account has been frozen by the admin due to a violation or other reasons. 
      You will not be able to access your account until the freeze period is over.\n\nFor any inquiries, please contact support.\n\nBest regards,\nAdmin Team`,
    };

    await transporter.sendMail(mailOptions);

    res.json({ message: "Househelp account frozen successfully, and email notification sent." });

  } catch (error) {
    console.error("❌ Error freezing househelp:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Delete Househelp Account and Notify via Email
router.delete("/househelps/:id", authenticateAdmin, async (req, res) => {
  try {
    console.log("Received DELETE request for househelp ID:", req.params.id);

    const househelp = await User.findById(req.params.id);
    if (!househelp) {
      console.log("Househelp not found");
      return res.status(404).json({ message: "Househelp not found" });
    }

    // Add email to blacklist
    const blacklistEntry = new Blacklist({ email: househelp.email, reason: "Account deleted by admin" });
    await blacklistEntry.save();

    // ✅ Send Email Notification Before Deleting Account
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: househelp.email,
      subject: "Account Deletion Notice ❌",
      text: `Dear ${househelp.fullname},\n\nYour account has been permanently deleted by the admin due to violations or other reasons. 
      You will no longer be able to access the platform.\n\nFor any inquiries, please contact support.\n\nBest regards,\nAdmin Team`,
    };

    await transporter.sendMail(mailOptions);

    // Delete the househelp account
    await househelp.deleteOne();

    // ✅ Log the action in AuditLog
    await AuditLog.create({
      admin: req.admin._id,
      action: `Deleted Househelp Account: ${househelp.fullname} (${househelp.email})`,
      targetUser: househelp._id
    });

    // ✅ Send real-time update
    sendUpdate("househelpDeleted", { id: househelp._id });

    console.log("Househelp deleted successfully");
    res.json({ message: "Househelp account deleted successfully, and email notification sent." });

  } catch (error) {
    console.error("Error deleting househelp:", error);
    res.status(500).json({ error: error.message });
  }
});


//load employers
router.get("/employers", authenticateAdmin, async (req, res) => {
  try {
      const { search } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const skip = (page - 1) * limit;

      let query = { userType: "employer" };

      // ✅ Search by Name, Email, or Location
      if (search) {
          query.$or = [
              { fullname: { $regex: search, $options: "i" } },
              { email: { $regex: search, $options: "i" } },
              { location: { $regex: search, $options: "i" } }
          ];
      }

      const totalEmployers = await User.countDocuments(query);
      const employers = await User.find(query, "fullname email location accountStatus")
          .skip(skip)
          .limit(limit);

      res.json({
          employers,
          totalPages: Math.ceil(totalEmployers / limit),
          currentPage: page
      });

  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

// ✅ Freeze Employer Account and Notify via Email
router.put("/employers/:id/freeze", authenticateAdmin, async (req, res) => {
  try {
    console.log("Received FREEZE request for employer ID:", req.params.id);

    const employer = await User.findById(req.params.id);
    if (!employer) {
      console.log("❌ Employer not found in database.");
      return res.status(404).json({ message: "Employer not found" });
    }

    // Ensure the user is actually an employer
    if (employer.userType !== "employer") {
      console.log("❌ User is not an employer.");
      return res.status(400).json({ message: "This user is not an employer" });
    }

    // ✅ Freeze the employer account
    employer.accountStatus = "frozen";
    employer.frozenUntil = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000); // Freeze for 6 months
    await employer.save();

    // ✅ Log the admin action in AuditLog
    await AuditLog.create({
      admin: req.admin._id,
      action: `Froze Employer Account: ${employer.fullname} (${employer.email})`,
      targetUser: employer._id
    });

    // ✅ Send real-time update
    sendUpdate("employerUpdated", { id: employer._id, status: "frozen" });

    // ✅ Send Email Notification to the Frozen Employer
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: employer.email,
      subject: "Account Frozen ❄️",
      text: `Dear ${employer.fullname},\n\nYour account has been frozen by the admin due to a violation or other reasons. 
      You will not be able to access your account until the freeze period is over.\n\nFor any inquiries, please contact support.\n\nBest regards,\nAdmin Team`,
    };

    await transporter.sendMail(mailOptions);

    console.log("✅ Employer frozen successfully.");
    res.json({ message: "Employer account frozen successfully, and email notification sent." });

  } catch (error) {
    console.error("❌ Error freezing employer:", error);
    res.status(500).json({ error: error.message });
  }
});


// ✅ Delete Employer Account and Notify via Email
router.delete("/employers/:id", authenticateAdmin, async (req, res) => {
  try {
    console.log("Received DELETE request for employer ID:", req.params.id);

    const employer = await User.findById(req.params.id);
    if (!employer) {
      console.log("❌ Employer not found in database.");
      return res.status(404).json({ message: "Employer not found" });
    }

    // Ensure the user is actually an employer
    if (employer.userType !== "employer") {
      console.log("❌ User is not an employer.");
      return res.status(400).json({ message: "This user is not an employer" });
    }

    // ✅ Add email to blacklist before deleting
    await Blacklist.create({ email: employer.email, reason: "Account deleted by admin" });

    // ✅ Send Email Notification Before Deleting Account
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: employer.email,
      subject: "Account Deletion Notice ❌",
      text: `Dear ${employer.fullname},\n\nYour account has been permanently deleted by the admin due to violations or other reasons. 
      You will no longer be able to access the platform.\n\nFor any inquiries, please contact support.\n\nBest regards,\nAdmin Team`,
    };

    await transporter.sendMail(mailOptions);

    // ✅ Delete the employer account
    await employer.deleteOne();

    // ✅ Log the admin action in AuditLog
    await AuditLog.create({
      admin: req.admin._id,
      action: `Deleted Employer Account: ${employer.fullname} (${employer.email})`,
      targetUser: employer._id
    });

    // ✅ Send real-time update
    sendUpdate("employerDeleted", { id: employer._id });

    console.log("✅ Employer deleted successfully.");
    res.json({ message: "Employer account deleted successfully, and email notification sent." });

  } catch (error) {
    console.error("❌ Error deleting employer:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/jobs", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1; // Default to page 1
    const limit = 10; // 10 jobs per page
    const skip = (page - 1) * limit;

    const totalJobs = await Job.countDocuments();
    const jobs = await Job.find({}, "title employer location createdAt")
      .populate("employer", "fullname") // Include employer name
      .skip(skip)
      .limit(limit);

    res.json({
      jobs,
      totalPages: Math.ceil(totalJobs / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Delete a Job
router.delete("/jobs/:id", authenticateAdmin, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    await job.deleteOne();
    res.json({ message: "Job deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get All Blacklisted Emails
router.get("/blacklist", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const totalBlacklist = await Blacklist.countDocuments();
    const blacklist = await Blacklist.find().skip(skip).limit(limit);

    res.json({
      blacklist,
      totalPages: Math.ceil(totalBlacklist / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add Email to Blacklist
router.post("/blacklist", authenticateAdmin, async (req, res) => {
  try {
    const { email, reason } = req.body;
    const blacklistEntry = new Blacklist({ email, reason });
    await blacklistEntry.save();
    res.status(201).json({ message: "Email added to blacklist successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove Email from Blacklist
router.delete("/blacklist/:email", authenticateAdmin, async (req, res) => {
  try {
    const email = req.params.email;
    await Blacklist.findOneAndDelete({ email });
    res.json({ message: "Email removed from blacklist successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/analytics", authenticateAdmin, async (req, res) => {
  try {
    const totalHousehelps = await User.countDocuments({ userType: "househelp" });
    const totalEmployers = await User.countDocuments({ userType: "employer" });
    const activeUsers = await User.countDocuments({ accountStatus: "active" });
    const frozenUsers = await User.countDocuments({ accountStatus: "frozen" });
    const totalJobs = await Job.countDocuments();
    const blacklistedUsers = await Blacklist.countDocuments();

    res.json({
      totalHousehelps,
      totalEmployers,
      activeUsers,
      frozenUsers,
      totalJobs,
      blacklistedUsers,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Get All Admins (Super Admins Only)
router.get("/admins", authenticateAdmin, async (req, res) => {
  try {
    // ✅ Ensure the requesting admin exists
    const requestingAdmin = await Admin.findById(req.admin.id);
    if (!requestingAdmin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // ✅ Ensure only Super Admins can access
    if (!requestingAdmin.isSuperAdmin) {
      return res.status(403).json({ message: "Access denied. Super Admins only." });
    }

    // ✅ Pagination setup
    const page = parseInt(req.query.page) || 1; // Default to page 1
    const limit = 10; // Show 10 admins per page
    const skip = (page - 1) * limit;

    const totalAdmins = await Admin.countDocuments();
    const admins = await Admin.find().skip(skip).limit(limit);

    res.json({
      admins,
      totalPages: Math.ceil(totalAdmins / limit),
      currentPage: page
    });
  } catch (error) {
    console.error("Error fetching admins:", error);
    res.status(500).json({ error: "Server error while fetching admins" });
  }
});

// Add New Admin (Super Admins Only)
router.post("/admins", authenticateAdmin, async (req, res) => {
  const { fullname, email, password, isSuperAdmin } = req.body;

  try {
    if (!req.admin.isSuperAdmin) return res.status(403).json({ message: "Access denied" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = new Admin({ fullname, email, password: hashedPassword, isSuperAdmin });
    await newAdmin.save();
    res.status(201).json({ message: "Admin added successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Admin (Super Admins Only)
router.delete("/admin/:id", authenticateAdmin, async (req, res) => {
  try {
    // ✅ Ensure the requesting admin exists
    const requestingAdmin = await Admin.findById(req.admin.id);
    if (!requestingAdmin) {
      return res.status(404).json({ message: "Requesting admin not found" });
    }

    // ✅ Ensure the admin to be deleted exists
    const adminToDelete = await Admin.findById(req.params.id);
    if (!adminToDelete) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // ✅ Prevent Super Admin from deleting themselves
    if (requestingAdmin.id === adminToDelete.id) {
      return res.status(403).json({ message: "You cannot delete your own Super Admin account." });
    }

    // ✅ Delete the admin
    await Admin.findByIdAndDelete(req.params.id);
    res.json({ message: "Admin deleted successfully" });
  } catch (error) {
    console.error("Error deleting admin:", error);
    res.status(500).json({ error: "Server error while deleting admin" });
  }
});

// Get All Unverified Users
router.get("/unverified-users", authenticateAdmin, async (req, res) => { 
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    // ✅ Only count users who have NOT been rejected
    const totalUnverified = await User.countDocuments({ 
      verificationStatus: false, 
      rejectionReason: null // ✅ Exclude rejected users
    });

    // ✅ Fetch only users who have NOT been rejected
    const unverifiedUsers = await User.find({ 
      verificationStatus: false, 
      rejectionReason: null // ✅ Exclude rejected users
    })
    .skip(skip)
    .limit(limit);

    res.json({
      unverifiedUsers,
      totalPages: Math.ceil(totalUnverified / limit),
      currentPage: page
    });
  } catch (error) {
    console.error("❌ Error fetching unverified users:", error);
    res.status(500).json({ error: "Failed to fetch pending verifications" });
  }
});


// Verify a User and Send Email Notification
router.put("/verify-user/:id", authenticateAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.verificationStatus = true;
    await user.save();

    // ✅ Send real-time update
    sendUpdate("userVerified", { id: user._id, verified: true });

    // ✅ Send Verification Email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Account Verified ✅",
      text: `Dear ${user.fullname},\n\nCongratulations! Your account has been successfully verified. You can now access all features.\n\nBest regards,\nAdmin Team`,
    };

    await transporter.sendMail(mailOptions);

    res.json({ message: "User verified successfully and email sent" });
  } catch (error) {
    console.error("Error verifying user:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Reject User Verification
router.put("/reject-user/:id", authenticateAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: "Rejection reason is required." });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    // ✅ Set verification status to false and store rejection reason
    user.verificationStatus = false;
    user.rejectionReason = reason;
    await user.save();

    console.log("✅ User status updated to 'false' and reason saved.");

    // ✅ Send Rejection Email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Verification Rejected",
      text: `Dear ${user.fullname},\n\nYour verification request has been rejected for the following reason:\n"${reason}"\n\nPlease contact support if you have any questions.\n\nBest regards,\nAdmin Team`,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("✅ Rejection email sent successfully.");
      res.json({ message: "User verification rejected and email sent." });
    } catch (emailError) {
      console.error("❌ Error sending rejection email:", emailError);
      res.status(500).json({ message: "User rejected, but email sending failed." });
    }
  } catch (error) {
    console.error("❌ Server Error:", error);
    res.status(500).json({ error: error.message });
  }
});



// ✅ GET Unverified User Details (Including Verification Docs)
router.get("/unverified-user/:id", authenticateAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      _id: user._id,  // ✅ Ensure ID is included
      fullname: user.fullname,
      email: user.email,
      userType: user.userType,
      location: user.location,
      phone: user.phone,
      verificationStatus: user.verificationStatus,
      idNumber: user.idNumber,
      nationality: user.nationality,
      faceScan: user.faceScan, // ✅ Include uploaded verification docs
      idFront: user.idFront,
      idBack: user.idBack
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/all-users", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1; // Get page from query params, default to 1
    const limit = 10; // Number of users per page
    const skip = (page - 1) * limit;

    const totalUsers = await User.countDocuments();
    const users = await User.find({}, "fullname location verificationStatus")
      .skip(skip)
      .limit(limit);

    
    res.json({
      users: users.map(user => ({
        fullname: user.fullname,
        location: user.location,
        verified: user.verificationStatus
      })),
      totalPages: Math.ceil(totalUsers / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.put("/freeze-user/:id", authenticateAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.accountStatus = "frozen";
    await user.save();

    // ✅ Log the action
    await AuditLog.create({
      admin: req.admin.id,
      action: "Froze User Account",
      targetUser: user._id
    });

    res.json({ message: "User frozen successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
//Delete user & log action
router.delete("/delete-user/:id", authenticateAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Log the action
    await AuditLog.create({
      admin: req.admin.id,
      action: "Deleted User Account",
      targetUser: user._id
    });

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/audit-logs", authenticateAdmin, async (req, res) => {
  try {
    const logs = await AuditLog.find().populate("admin", "fullname").sort({ timestamp: -1 });
    res.json(logs.map(log => ({
      adminName: log.admin.fullname,
      action: log.action,
      timestamp: log.timestamp
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;