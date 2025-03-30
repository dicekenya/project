const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    rating: { type: Number, required: true, min: 1, max: 5 }, // Rating value (1-5)
    comment: { type: String, required: true }, // Review comment
    employer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to the employer being reviewed
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to the user who wrote the review
    createdAt: { type: Date, default: Date.now } // Timestamp of the review
});

module.exports = mongoose.model('Review', reviewSchema);