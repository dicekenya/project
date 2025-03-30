const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // Basic Information
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    gender: { type: String },
    userType: { type: String, required: true, enum: ["employer", "househelp"] },
    location: { type: String },
    profilePhoto: { type: String, default: "default.jpg" }, // URL to profile photo

    // Verification Fields
    verificationStatus: { type: Boolean, default: false },
    rejectionReason: { type: String, default: null }, // ✅ New field for rejection reason
    idNumber: { type: String },
    nationality: { type: String },
    religion: { type: String },
    maritalStatus: { type: String },
    age: { type: Number },
    dob: { type: Date },
    healthIssues: { type: String },
    faceScan: { type: String }, // URL or base64 encoded image
    idFront: { type: String }, // URL or base64 encoded image
    idBack: { type: String }, // URL or base64 encoded image

    // Fields for Househelps
    skills: { type: [String] }, // Array of skills (e.g., ["Cooking", "Cleaning"])
    experience: { type: String }, // Experience in years or description
    isAvailable: { type: Boolean, default: true }, // Availability status

    // Fields for Employers
    jobsPosted: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Job' }], // Jobs posted by the employer
    companyName: { type: String }, // Optional for employers

    // Reviews and Ratings
    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }], // Reference to Review model
    averageRating: { type: Number, default: 0 }, // Average rating (calculated field)

    accountStatus: { type: String, enum: ["active", "frozen", "deleted"], default: "active" },
    frozenUntil: { type: Date }, // Date until which the account is frozen
    isBlacklisted: { type: Boolean, default: false }, // Prevent sign-up if true
   
    // Timestamps
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });


const User = mongoose.model('User', userSchema);
module.exports = User;