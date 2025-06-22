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

// 記事版和Admin系統
let boards = [
  {
    id: 'default',
    name: '主記事版',
    theme: 'default',
    description: '預設的公共記事版',
    createdAt: new Date(),
    createdBy: 'system',
    isPublic: true
  }
];

// Admin用戶列表（使用查詢參數admin=admin123來成為管理員）
let adminUsers = new Set();

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

  // 發送記事版列表給新用戶
  socket.emit('all-boards', boards);

  // 檢查是否為admin並發送用戶信息
  const isAdmin = socket.handshake.query.admin === 'admin123';
  if (isAdmin) {
    adminUsers.add(socket.id);
    console.log('管理員已連接:', socket.id);
  }
  
  socket.emit('user-info', {
    id: socket.id,
    name: `用戶${socket.id.slice(-4)}`,
    isAdmin: isAdmin,
    joinedAt: new Date()
  });

  // 處理新memo創建
  socket.on('create-memo', (memoData) => {
    const newMemo = {
      id: uuidv4(),
      content: memoData.content,
      image: memoData.image,
      x: memoData.x || Math.random() * 800,
      y: memoData.y || Math.random() * 600,
      color: memoData.color || '#ffd700',
      boardId: memoData.boardId || 'default',
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

  // Admin專用：創建記事版
  socket.on('create-board', (boardData) => {
    const isAdmin = adminUsers.has(socket.id);
    if (isAdmin) {
      const newBoard = {
        id: uuidv4(),
        name: boardData.name,
        theme: boardData.theme || 'default',
        description: boardData.description || '',
        createdAt: new Date(),
        createdBy: socket.id,
        isPublic: boardData.isPublic !== false
      };
      boards.push(newBoard);
      io.emit('board-created', newBoard);
      console.log('新記事版已創建:', newBoard.name);
    } else {
      socket.emit('error', { message: '權限不足' });
    }
  });

  // Admin專用：刪除記事版
  socket.on('delete-board', (boardId) => {
    const isAdmin = adminUsers.has(socket.id);
    if (isAdmin && boardId !== 'default') {
      boards = boards.filter(b => b.id !== boardId);
      memos = memos.filter(m => m.boardId !== boardId);
      io.emit('board-deleted', boardId);
      console.log('記事版已刪除:', boardId);
    } else {
      socket.emit('error', { message: '權限不足或無法刪除預設記事版' });
    }
  });

  // Admin專用：刪除任何memo
  socket.on('admin-delete-memo', (memoId) => {
    const isAdmin = adminUsers.has(socket.id);
    if (isAdmin) {
      memos = memos.filter(m => m.id !== memoId);
      io.emit('memo-deleted', memoId);
      console.log('Admin刪除memo:', memoId);
    } else {
      socket.emit('error', { message: '權限不足' });
    }
  });

  // Admin專用：清除所有memo
  socket.on('admin-clear-all-memos', (boardId) => {
    const isAdmin = adminUsers.has(socket.id);
    if (isAdmin) {
      if (boardId) {
        // 清除指定記事版的memo
        const beforeCount = memos.length;
        memos = memos.filter(m => m.boardId !== boardId);
        const afterCount = memos.length;
        console.log(`Admin清除了記事版 ${boardId} 的 ${beforeCount - afterCount} 個memo`);
        
        // 發送更新後的memo列表給所有用戶
        io.emit('all-memos', memos);
      } else {
        // 清除所有memo（如果沒有指定boardId）
        memos = [];
        console.log('Admin清除了所有memo');
        io.emit('all-memos', memos);
      }
    } else {
      socket.emit('error', { message: '權限不足' });
    }
  });

  // 處理記事版切換
  socket.on('switch-board', (boardId) => {
    console.log(`用戶 ${socket.id} 切換到記事版: ${boardId}`);
    // 發送該記事版的memo給用戶
    const boardMemos = memos.filter(m => m.boardId === boardId);
    socket.emit('all-memos', boardMemos);
  });

  // 用戶斷開連接
  socket.on('disconnect', () => {
    console.log('用戶已斷開連接:', socket.id);
    adminUsers.delete(socket.id);
    connectedUsers.delete(socket.id);
    io.emit('user-count', connectedUsers.size);
    io.emit('user-disconnected', socket.id);
  });
});

// API 路由
app.get('/api/memos', (req, res) => {
  res.json(memos);
});

// 獲取所有記事版
app.get('/api/boards', (req, res) => {
  res.json(boards);
});

// 獲取特定記事版的memo
app.get('/api/boards/:boardId/memos', (req, res) => {
  const boardMemos = memos.filter(m => m.boardId === req.params.boardId);
  res.json(boardMemos);
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