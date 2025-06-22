const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

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
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 創建數據存儲目錄
if (!fs.existsSync('data')) {
  fs.mkdirSync('data');
}

// 數據文件路徑
const DATA_FILES = {
  likes: './data/likes.json',
  comments: './data/comments.json',
  memos: './data/memos.json'
};

// 加載數據的函數
const loadData = (filePath, defaultValue = []) => {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`載入數據失敗 ${filePath}:`, error);
  }
  return defaultValue;
};

// 保存數據的函數
const saveData = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`數據已保存到 ${filePath}`);
  } catch (error) {
    console.error(`保存數據失敗 ${filePath}:`, error);
  }
};

// 存儲所有memo貼的數據
let memos = loadData(DATA_FILES.memos, []);
let connectedUsers = new Map();

// 存儲點讚和評論數據
let likes = loadData(DATA_FILES.likes, []); // { id, memoId, userId, userName, createdAt }
let comments = loadData(DATA_FILES.comments, []); // { id, memoId, userId, userName, content, createdAt }

// 防抖機制 - 防止重複快速點讚
const likeDebounce = new Map(); // userId-memoId -> timestamp
const LIKE_DEBOUNCE_TIME = 1000; // 1秒防抖

// 記事版和Admin系統 - 更新為科目分區系統
const subjects = [
  { id: 'chinese', name: '中文', icon: '📝' },
  { id: 'english', name: '英文', icon: '🔤' },
  { id: 'math', name: '數學', icon: '🔢' },
  { id: 'science', name: '科學', icon: '🔬' },
  { id: 'humanities', name: '人文', icon: '🏛️' },
  { id: 'mandarin', name: '普通話', icon: '🗣️' },
  { id: 'visual-arts', name: '視藝', icon: '🎨' },
  { id: 'music', name: '音樂', icon: '🎵' },
  { id: 'library', name: '圖書', icon: '📚' },
  { id: 'pe', name: '體育', icon: '⚽' }
];

let boards = []; // 移除預設的主記事版

// Admin用戶列表（使用查詢參數admin=admin123來成為管理員）
let adminUsers = new Set();

// Socket.io 連接處理
io.on('connection', (socket) => {
  console.log('🔌 用戶已連接:', socket.id);

  // 當用戶加入時，發送所有現有的memo給他們
  socket.emit('all-memos', memos);
  console.log(`📝 已發送 ${memos.length} 個memos給用戶 ${socket.id}`);
  
  // 發送所有現有的點讚數據
  if (likes.length > 0) {
    socket.emit('all-likes', likes);
    console.log(`❤️ 已發送 ${likes.length} 個點讚給用戶 ${socket.id}`);
  }
  
  // 發送所有現有的留言數據
  if (comments.length > 0) {
    socket.emit('all-comments', comments);
    console.log(`💬 已發送 ${comments.length} 個留言給用戶 ${socket.id}`);
  }
  
  // 廣播用戶數量
  connectedUsers.set(socket.id, {
    id: socket.id,
    joinedAt: new Date()
  });
  
  io.emit('user-count', connectedUsers.size);
  console.log(`👥 當前連接用戶數: ${connectedUsers.size}`);

  // 發送記事版列表給新用戶
  socket.emit('all-boards', boards);
  console.log(`📋 已發送 ${boards.length} 個記事版給用戶 ${socket.id}`);

  // 發送科目列表給新用戶
  socket.emit('all-subjects', subjects);
  console.log(`📚 已發送 ${subjects.length} 個科目給用戶 ${socket.id}`);

  // 檢查是否為admin並發送用戶信息
  const isAdmin = socket.handshake.query.admin === 'admin123';
  if (isAdmin) {
    adminUsers.add(socket.id);
    console.log('👑 管理員已連接:', socket.id);
  }
  
  socket.emit('user-info', {
    id: socket.id,
    name: `用戶${socket.id.slice(-4)}`,
    isAdmin: isAdmin,
    joinedAt: new Date()
  });
  console.log(`👤 已發送用戶信息給 ${socket.id}`);

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
    
    // 保存memo數據
    saveData(DATA_FILES.memos, memos);
    
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
    
    // 保存更新後的數據
    saveData(DATA_FILES.memos, memos);
    saveData(DATA_FILES.likes, likes);
    saveData(DATA_FILES.comments, comments);
    
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

  // 處理記事版創建 - 更新為支援科目分區
  socket.on('create-board', (boardData) => {
    console.log('收到創建記事版請求:', boardData);
    
    if (adminUsers.has(socket.id)) {
      const newBoard = {
        id: uuidv4(),
        name: boardData.name,
        theme: boardData.theme || 'default',
        description: boardData.description || '',
        subjectId: boardData.subjectId, // 新增科目ID
        createdAt: new Date(),
        createdBy: socket.id,
        isPublic: true
      };
      
      boards.push(newBoard);
      console.log('新記事版已創建:', newBoard.name, '科目:', boardData.subjectId);
      
      // 廣播新記事版給所有用戶
      io.emit('board-created', newBoard);
    } else {
      socket.emit('error', { message: '只有管理員可以創建記事版' });
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
      
      // 保存更新後的數據
      saveData(DATA_FILES.memos, memos);
      saveData(DATA_FILES.likes, likes);
      saveData(DATA_FILES.comments, comments);
      
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
        
        // 保存更新後的數據
        saveData(DATA_FILES.memos, memos);
        saveData(DATA_FILES.likes, likes);
        saveData(DATA_FILES.comments, comments);
        
        // 發送更新後的memo列表給所有用戶
        io.emit('all-memos', memos);
      } else {
        // 清除所有memo（如果沒有指定boardId）
        memos = [];
        likes = [];
        comments = [];
        
        // 保存清空的數據
        saveData(DATA_FILES.memos, memos);
        saveData(DATA_FILES.likes, likes);
        saveData(DATA_FILES.comments, comments);
        
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

  // 處理點讚 - 改進版本
  socket.on('like-memo', (memoId) => {
    console.log(`❤️ 收到點讚請求: 用戶 ${socket.id} -> memo ${memoId}`);
    
    const userId = socket.id;
    const userName = `用戶${userId.slice(-4)}`;
    const debounceKey = `${userId}-${memoId}`;
    const now = Date.now();
    
    // 檢查防抖
    const lastLikeTime = likeDebounce.get(debounceKey);
    if (lastLikeTime && (now - lastLikeTime) < LIKE_DEBOUNCE_TIME) {
      console.log(`⏱️ 點讚被防抖阻止: ${userName} -> ${memoId}`);
      return;
    }
    
    // 檢查用戶是否已經點讚過
    const existingLikeIndex = likes.findIndex(like => like.memoId === memoId && like.userId === userId);
    
    if (existingLikeIndex !== -1) {
      // 取消點讚
      likes.splice(existingLikeIndex, 1);
      console.log(`💔 用戶 ${userName} 取消點讚 memo: ${memoId}`);
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
      console.log(`💖 用戶 ${userName} 點讚 memo: ${memoId}`);
      
      // 廣播新點讚給所有用戶
      io.emit('new-like', newLike);
      console.log(`📡 已廣播新點讚給所有用戶`);
    }
    
    // 更新防抖時間戳
    likeDebounce.set(debounceKey, now);
    
    // 保存點讚數據
    saveData(DATA_FILES.likes, likes);
    
    // 發送該memo的所有點讚給所有用戶
    const memoLikes = likes.filter(like => like.memoId === memoId);
    io.emit('memo-likes', memoId, memoLikes);
    console.log(`📡 已發送memo ${memoId} 的 ${memoLikes.length} 個點讚給所有用戶`);
  });

  // 處理評論 - 改進版本
  socket.on('comment-memo', (data) => {
    console.log(`💬 收到評論請求: 用戶 ${socket.id}`, data);
    
    const { memoId, content } = data;
    const userId = socket.id;
    const userName = `用戶${userId.slice(-4)}`;
    
    // 驗證內容
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      console.log(`❌ 評論內容為空，拒絕請求`);
      socket.emit('error', { message: '評論內容不能為空' });
      return;
    }
    
    if (content.length > 500) {
      console.log(`❌ 評論內容過長，拒絕請求`);
      socket.emit('error', { message: '評論內容過長' });
      return;
    }
    
    const newComment = {
      id: uuidv4(),
      memoId: memoId,
      userId: userId,
      userName: userName,
      content: content.trim(),
      createdAt: new Date().toISOString()
    };
    
    comments.push(newComment);
    console.log(`✅ 用戶 ${userName} 評論 memo ${memoId}: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
    
    // 保存評論數據
    saveData(DATA_FILES.comments, comments);
    
    // 廣播新評論給所有用戶
    io.emit('new-comment', newComment);
    console.log(`📡 已廣播新評論給所有用戶`);
    
    // 發送該memo的所有評論給所有用戶
    const memoComments = comments.filter(comment => comment.memoId === memoId);
    io.emit('memo-comments', memoId, memoComments);
    console.log(`📡 已發送memo ${memoId} 的 ${memoComments.length} 個評論給所有用戶`);
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

// 獲取所有科目
app.get('/api/subjects', (req, res) => {
  res.json(subjects);
});

// 獲取特定科目的記事版
app.get('/api/subjects/:subjectId/boards', (req, res) => {
  const subjectBoards = boards.filter(b => b.subjectId === req.params.subjectId);
  res.json(subjectBoards);
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
  console.log(`點讚和評論功能已啟用 - 版本 v1.1`);
}); 