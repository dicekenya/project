const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const Job = require('../models/Job');
const User = require('../models/User');

// ✅ Import `sendUpdate` After Exporting Routes
let sendUpdate;
setTimeout(() => {
    sendUpdate = require("../server").sendUpdate;
}, 1000);


// ✅ POST a Job (Only Employers Can Post)
router.post('/', authenticate, async (req, res) => {
    try {
        if (req.user.userType !== 'employer') {
            return res.status(403).json({ message: 'Forbidden: Only employers can post jobs' });
        }

        const newJob = new Job({
            employer: req.user._id,
            title: req.body.title,
            description: req.body.description,
            location: req.body.location
        });

        await newJob.save();
        sendUpdate("jobPosted", {
            id: newJob._id,
            title: newJob.title,
            description: newJob.description,
            location: newJob.location,
            employerName: req.user.fullname
          });
        res.status(201).json({ message: 'Job posted successfully', job: newJob });
    } catch (error) {
        console.error('Error posting job:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// ✅ GET All Jobs (Househelps Can See All Jobs)
router.get('/', async (req, res) => {
    try {
        const jobs = await Job.find().populate('employer', 'fullname');
        res.json(jobs.map(job => ({
            _id: job._id,
            title: job.title,
            description: job.description,
            location: job.location,
            employerName: job.employer.fullname // ✅ Show employer name
        })));
    } catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// ✅ GET Jobs Posted by Logged-in Employer
router.get('/employer', authenticate, async (req, res) => {
    try {
        if (req.user.userType !== 'employer') {
            return res.status(403).json({ message: 'Forbidden: Only employers can view their jobs' });
        }

        const jobs = await Job.find({ employer: req.user._id });
        res.json(jobs);
    } catch (error) {
        console.error('Error fetching employer jobs:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// ✅ DELETE Job (Only Employer Who Posted Can Delete)
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        if (job.employer.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Forbidden: You can only delete your own jobs' });
        }

        await job.deleteOne();
        // ✅ Send real-time update
    sendUpdate("jobDeleted", { id: job._id });

        res.json({ message: 'Job deleted successfully' });
    } catch (error) {
        console.error('Error deleting job:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// ✅ APPLY for a Job (Only Verified Househelps Can Apply)
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

        // ✅ Ensure `applications` array exists
        if (!Array.isArray(job.applications)) {
            job.applications = [];
        }

        // ✅ Prevent duplicate applications
        if (job.applications.some(app => app.userId.toString() === req.user._id.toString())) {
            return res.status(400).json({ message: 'You have already applied for this job' });
        }

        const applicantDetails = {
            userId: req.user._id,
            name: req.user.fullname || "Unknown",
            age: req.user.age || "N/A",
            phone: req.user.phone || "N/A",
            skills: req.user.skills || "N/A",

            location: req.user.location || "N/A"

        };

        job.applications.push(applicantDetails);
        await job.save();
        // ✅ Send real-time update
    sendUpdate("jobApplication", { jobId: job._id, househelpId: req.user._id });


        res.status(200).json({ message: 'Application submitted successfully', job });
    } catch (error) {
        console.error('Error applying for job:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

router.delete('/:id/cancel', authenticate, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        // ✅ Remove only THIS user's application from THIS job
        const initialLength = job.applications.length;
        job.applications = job.applications.filter(
            app => app.userId.toString() !== req.user._id.toString()
        );

        // ✅ Ensure an application was actually removed
        if (job.applications.length === initialLength) {
            return res.status(400).json({ message: 'You have not applied for this job' });
        }

        await job.save();
        res.json({ message: 'Application canceled successfully' });
    } catch (error) {
        console.error('Error canceling application:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});





// ✅ VIEW Applicants for a Job (Only Employer Who Posted Can View)
router.get('/:id/applicants', authenticate, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        if (job.employer.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Forbidden: You do not own this job' });
        }

        // ✅ Check if applications exist
        if (!job.applications || job.applications.length === 0) {
            return res.status(200).json({ title: job.title, message: 'No applicants yet.', applications: [] });
        }

        res.status(200).json({ title: job.title, applications: job.applications });
    } catch (error) {
        console.error('Error fetching applicants:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});
// ✅ GET Applied Jobs for a Specific Househelp
router.get('/applied', authenticate, async (req, res) => {
    try {
        if (req.user.userType !== 'househelp') {
            return res.status(403).json({ message: 'Forbidden: Only househelps can view applied jobs' });
        }

        // ✅ Populate employer's name instead of just showing ID
        const appliedJobs = await Job.find({ 'applications.userId': req.user._id })
            .populate('employer', 'fullname'); // ✅ This fetches only the fullname

        res.json(appliedJobs.map(job => ({
            _id: job._id,
            title: job.title,
            description: job.description,
            location: job.location,
            employerName: job.employer ? job.employer.fullname : "Unknown Employer", // ✅ Fix employer name
        })));
    } catch (error) {
        console.error("Error fetching applied jobs:", error);
        res.status(500).json({ message: "Server error fetching applied jobs." });
    }
});
router.post('/:id/chat', authenticate, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        if (!job.employer) {
            return res.status(400).json({ message: 'Job does not have an associated employer.' });
        }

        console.log("📨 Househelp sending message to employer", req.user._id, "for job", req.params.id);

        const newMessage = {
            sender: req.user._id,
            receiver: job.employer, // ✅ Employer is the receiver
            text: req.body.text
        };

        job.messages.push(newMessage);
        await job.save();

        res.status(200).json({ message: 'Message sent', chat: job.messages });
    } catch (error) {
        console.error('❌ Error sending message:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


router.get('/:id/chat', authenticate, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id).populate('messages.sender', 'fullname');
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        console.log("✅ Fetching all chat messages for job:", req.params.id);

        // ✅ Return only messages between the logged-in househelp and the employer
        const messages = job.messages.filter(msg =>
            (msg.sender.equals(req.user._id) && msg.receiver.equals(job.employer)) ||
            (msg.sender.equals(job.employer) && msg.receiver.equals(req.user._id))
        );

        res.status(200).json(messages);
    } catch (error) {
        console.error('❌ Error fetching chat:', error);
        res.status(500).json({ message: 'Server error' });
    }
});
router.get('/:id/chat/:userId', authenticate, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id)
            .populate('messages.sender', 'fullname') // ✅ Populate sender name
            .populate('messages.receiver', 'fullname'); // ✅ Populate receiver name

        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }


        // ✅ Return only messages exchanged between the employer and the specific applicant
        const messages = job.messages.filter(msg =>
            (msg.sender.equals(req.user._id) && msg.receiver.equals(req.params.userId)) ||
            (msg.sender.equals(req.params.userId) && msg.receiver.equals(req.user._id))
        );

        res.status(200).json(messages);
    } catch (error) {
        console.error('❌ Error fetching chat:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/:id/chat/:userId', authenticate, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        console.log("📨 Employer sending message to applicant", req.params.userId, "for job", req.params.id);

        const newMessage = {
            sender: req.user._id, 
            receiver: req.params.userId, // ✅ Househelp is the receiver
            text: req.body.text
        };

        job.messages.push(newMessage);
        await job.save();

        res.status(200).json({ message: 'Message sent', chat: job.messages });
    } catch (error) {
        console.error('❌ Error sending message:', error);
        res.status(500).json({ message: 'Server error' });
    }
});




module.exports = router;
