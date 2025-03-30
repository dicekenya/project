require('dotenv').config();

const express = require('express');
const http = require('http'); // Required for WebSockets
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config(); // ✅ Load environment variables

const app = express();
const server = http.createServer(app); // Create HTTP server

// ✅ WebSocket Server Setup
const io = new Server(server, {
  cors: {
    origin: "http://127.0.0.1:5500", // Your frontend origin
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// ✅ Middleware
app.use(cors({
  origin: 'http://127.0.0.1:5500', // Allow frontend requests
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type,Authorization'
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ✅ First, Export `app` and `server` (Prevents Circular Dependency)
module.exports = { app, server };

// ✅ Import Routes (Now After Exporting `app`)
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/employer', authRoutes);
app.use('/api/admin', adminRoutes);

// ✅ WebSocket Connection Handling
io.on("connection", (socket) => {
  console.log("🔥 New client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("⚠️ Client disconnected:", socket.id);
  });
});

// ✅ Function to Send Real-Time Updates (Export After Definition)
const sendUpdate = (event, data) => {
  io.emit(event, data); // Broadcast update to all connected clients
};

// ✅ Export `sendUpdate` Separately to Avoid Circular Dependency
module.exports.sendUpdate = sendUpdate;

// ✅ MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected successfully');
    server.listen(process.env.PORT || 5000, () => console.log(`🚀 Server running on port ${process.env.PORT || 5000}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ✅ Test Route
app.get('/', (req, res) => {
  res.send('Backend is running with WebSocket support.');
});
