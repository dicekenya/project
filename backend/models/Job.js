const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    location: { type: String, required: true },
    employer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    applications: [
        {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            name: String,
            age: Number,
            phone: String
        }
    ],
    messages: [
        {
            sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Who sent the message
            receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Who receives the message
            text: String,
            timestamp: { type: Date, default: Date.now }
        }
    ]
    
}, { timestamps: true });

const Job = mongoose.model('Job', jobSchema);
module.exports = Job;
