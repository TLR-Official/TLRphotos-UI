import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import photosRouter from './routes/photos';
import articlesRouter from './routes/articles';
import columnRouter from './routes/column';
import authRouter from './routes/auth';
import tagsRouter from './routes/tags';
import { initDb } from './db';
import { initTagsDb } from './db/tagsDb';
import { cleanupExpired } from './services/cookieService';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
  res.setTimeout(120000, () => {
    console.error('Request timeout:', req.method, req.originalUrl);
    res.status(504).json({ success: false, message: '请求超时，请重试' });
  });
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/photos', photosRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/column', columnRouter);
app.use('/api/tags', tagsRouter);

app.use('/articles', express.static(path.join(__dirname, '../../articles')));
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'TLRphotos API is running', timestamp: new Date().toISOString() });
});

function scheduleCleanup() {
  const runCleanup = async () => {
    try {
      const deletedCount = await cleanupExpired();
      console.log(`[Cleanup] Deleted ${deletedCount} expired sessions at ${new Date().toISOString()}`);
    } catch (error) {
      console.error('[Cleanup] Failed to clean up expired sessions:', error);
    }
  };

  runCleanup();

  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const delay = midnight.getTime() - now.getTime();

  setTimeout(() => {
    runCleanup();
    setInterval(runCleanup, 24 * 60 * 60 * 1000);
  }, delay);
}

const startServer = async () => {
  try {
    await initDb();
    await initTagsDb();
    scheduleCleanup();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`TLRphotos backend server running on http://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
