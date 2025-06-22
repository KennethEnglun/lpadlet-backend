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

// 存儲點讚和評論數據
let likes = []; // { id, memoId, userId, userName, createdAt }
let comments = []; // { id, memoId, userId, userName, content, createdAt }

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
      createdBy: socket.id,
      userName: memoData.userName || null
    };
    
    memos.push(newMemo);
    
    // 廣播新memo給所有用戶
    io.emit('new-memo', newMemo);
    console.log('新memo已創建:', newMemo.id, '用戶:', newMemo.userName || '匿名');
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
    // 同時刪除相關的點讚和評論
    likes = likes.filter(like => like.memoId !== memoId);
    comments = comments.filter(comment => comment.memoId !== memoId);
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
      // 獲取要刪除的memo ID列表
      const boardMemoIds = memos.filter(m => m.boardId === boardId).map(m => m.id);
      memos = memos.filter(m => m.boardId !== boardId);
      // 同時刪除相關的點讚和評論
      likes = likes.filter(like => !boardMemoIds.includes(like.memoId));
      comments = comments.filter(comment => !boardMemoIds.includes(comment.memoId));
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
      // 同時刪除相關的點讚和評論
      likes = likes.filter(like => like.memoId !== memoId);
      comments = comments.filter(comment => comment.memoId !== memoId);
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
        const boardMemoIds = memos.filter(m => m.boardId === boardId).map(m => m.id);
        memos = memos.filter(m => m.boardId !== boardId);
        // 同時清除相關的點讚和評論
        likes = likes.filter(like => !boardMemoIds.includes(like.memoId));
        comments = comments.filter(comment => !boardMemoIds.includes(comment.memoId));
        const afterCount = memos.length;
        console.log(`Admin清除了記事版 ${boardId} 的 ${beforeCount - afterCount} 個memo`);
        
        // 發送更新後的memo列表給所有用戶
        io.emit('all-memos', memos);
      } else {
        // 清除所有memo（如果沒有指定boardId）
        memos = [];
        likes = [];
        comments = [];
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

  // 處理點讚
  socket.on('like-memo', (memoId) => {
    const userId = socket.id;
    const userName = `用戶${userId.slice(-4)}`;
    
    // 檢查用戶是否已經點讚過
    const existingLike = likes.find(like => like.memoId === memoId && like.userId === userId);
    
    if (existingLike) {
      // 取消點讚
      likes = likes.filter(like => !(like.memoId === memoId && like.userId === userId));
      console.log(`用戶 ${userName} 取消點讚 memo: ${memoId}`);
    } else {
      // 添加點讚
      const newLike = {
        id: uuidv4(),
        memoId: memoId,
        userId: userId,
        userName: userName,
        createdAt: new Date().toISOString()
      };
      likes.push(newLike);
      console.log(`用戶 ${userName} 點讚 memo: ${memoId}`);
      
      // 廣播新點讚給所有用戶
      io.emit('new-like', newLike);
    }
    
    // 發送該memo的所有點讚給所有用戶
    const memoLikes = likes.filter(like => like.memoId === memoId);
    io.emit('memo-likes', memoId, memoLikes);
  });

  // 處理評論
  socket.on('comment-memo', (data) => {
    const { memoId, content } = data;
    const userId = socket.id;
    const userName = `用戶${userId.slice(-4)}`;
    
    const newComment = {
      id: uuidv4(),
      memoId: memoId,
      userId: userId,
      userName: userName,
      content: content,
      createdAt: new Date().toISOString()
    };
    
    comments.push(newComment);
    console.log(`用戶 ${userName} 評論 memo ${memoId}: ${content}`);
    
    // 廣播新評論給所有用戶
    io.emit('new-comment', newComment);
    
    // 發送該memo的所有評論給所有用戶
    const memoComments = comments.filter(comment => comment.memoId === memoId);
    io.emit('memo-comments', memoId, memoComments);
  });

  // 獲取memo的點讚列表
  socket.on('get-memo-likes', (memoId) => {
    const memoLikes = likes.filter(like => like.memoId === memoId);
    socket.emit('memo-likes', memoId, memoLikes);
  });

  // 獲取memo的評論列表
  socket.on('get-memo-comments', (memoId) => {
    const memoComments = comments.filter(comment => comment.memoId === memoId);
    socket.emit('memo-comments', memoId, memoComments);
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

// 獲取memo的點讚
app.get('/api/memos/:memoId/likes', (req, res) => {
  const memoLikes = likes.filter(like => like.memoId === req.params.memoId);
  res.json(memoLikes);
});

// 獲取memo的評論
app.get('/api/memos/:memoId/comments', (req, res) => {
  const memoComments = comments.filter(comment => comment.memoId === req.params.memoId);
  res.json(memoComments);
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
    likes: likes.length,
    comments: comments.length,
    connectedUsers: connectedUsers.size 
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`服務器運行在端口 ${PORT}`);
  console.log(`健康檢查: http://localhost:${PORT}/health`);
}); 