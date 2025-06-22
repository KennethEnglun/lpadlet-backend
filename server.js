const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:5173", "https://lpadlet.netlify.app"],
    methods: ["GET", "POST"]
  }
});

// 中間件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// 配置multer用於圖片上傳
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允許上傳圖片文件！'));
    }
  }
});

// 創建uploads目錄
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 存儲所有memo貼的數據
let memos = [];
let connectedUsers = new Map();

// Socket.io 連接處理
io.on('connection', (socket) => {
  console.log('用戶已連接:', socket.id);

  // 當用戶加入時，發送所有現有的memo給他們
  socket.emit('all-memos', memos);
  
  // 廣播用戶數量
  connectedUsers.set(socket.id, {
    id: socket.id,
    joinedAt: new Date()
  });
  
  io.emit('user-count', connectedUsers.size);

  // 處理新memo創建
  socket.on('create-memo', (memoData) => {
    const newMemo = {
      id: uuidv4(),
      content: memoData.content,
      image: memoData.image,
      x: memoData.x || Math.random() * 800,
      y: memoData.y || Math.random() * 600,
      color: memoData.color || '#ffd700',
      createdAt: new Date(),
      createdBy: socket.id
    };
    
    memos.push(newMemo);
    
    // 廣播新memo給所有用戶
    io.emit('new-memo', newMemo);
    console.log('新memo已創建:', newMemo.id);
  });

  // 處理memo位置更新
  socket.on('update-memo-position', (data) => {
    const { id, x, y } = data;
    const memo = memos.find(m => m.id === id);
    if (memo) {
      memo.x = x;
      memo.y = y;
      // 廣播位置更新給其他用戶
      socket.broadcast.emit('memo-position-updated', { id, x, y });
    }
  });

  // 處理memo內容更新
  socket.on('update-memo-content', (data) => {
    const { id, content } = data;
    const memo = memos.find(m => m.id === id);
    if (memo) {
      memo.content = content;
      // 廣播內容更新給其他用戶
      socket.broadcast.emit('memo-content-updated', { id, content });
    }
  });

  // 處理memo刪除
  socket.on('delete-memo', (memoId) => {
    memos = memos.filter(m => m.id !== memoId);
    // 廣播刪除事件給所有用戶
    io.emit('memo-deleted', memoId);
    console.log('Memo已刪除:', memoId);
  });

  // 處理實時光標位置
  socket.on('cursor-move', (data) => {
    socket.broadcast.emit('user-cursor', {
      userId: socket.id,
      x: data.x,
      y: data.y
    });
  });

  // 用戶斷開連接
  socket.on('disconnect', () => {
    console.log('用戶已斷開連接:', socket.id);
    connectedUsers.delete(socket.id);
    io.emit('user-count', connectedUsers.size);
    io.emit('user-disconnected', socket.id);
  });
});

// API 路由
app.get('/api/memos', (req, res) => {
  res.json(memos);
});

// 圖片上傳端點
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '沒有上傳文件' });
  }
  
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

// 健康檢查端點
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    memos: memos.length, 
    connectedUsers: connectedUsers.size 
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`服務器運行在端口 ${PORT}`);
  console.log(`健康檢查: http://localhost:${PORT}/health`);
}); 