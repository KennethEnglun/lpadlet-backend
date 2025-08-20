# 🚀 LPadlet Backend

## 簡介
LPadlet 後端服務器，提供實時Socket.io支持和文件上傳功能。

## 本地開發

```bash
# 安裝依賴
npm install

# 開發模式運行
npm run dev

# 生產模式運行
npm start
```

## Railway 部署步驟

### 方法1: 直接部署此資料夾

1. 將此 `lpadlet-backend` 資料夾推送到獨立的GitHub倉庫
2. 在Railway中連接該倉庫
3. Railway會自動識別Node.js項目並部署

### 方法2: 使用GitHub子資料夾

1. 在Railway項目設置中：
   - Root Directory: 留空（因為現在是獨立資料夾）
   - Build Command: `npm install`
   - Start Command: `npm start`

## 環境變量

在Railway中設置以下環境變量：
- `NODE_ENV=production`
- `PORT` (Railway會自動設置)

## API端點

- `GET /health` - 健康檢查
- `POST /upload` - 文件上傳
- Socket.io事件 - 實時協作功能

## 技術棧

- Node.js + Express
- Socket.io (實時通信)
- Multer (文件上傳)
- CORS (跨域支持) # Last updated: Wed Aug 20 11:38:29 HKT 2025
