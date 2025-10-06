const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:4200", // Angular dev server
    methods: ["GET", "POST"]
  }
});

const messages = []; // In-memory history

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  // Send history immediately
  socket.emit("chatHistory", messages);

  socket.on("chatMessage", (msg) => {
    console.log("💬 Message:", msg);

    // Save message to history
    messages.push(msg);

    // Broadcast new message
    io.emit("chatMessage", msg);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});
