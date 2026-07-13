import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import photosRouter from './routes/photos';
import articlesRouter from './routes/articles';
import columnRouter from './routes/column';
import authRouter from './routes/auth';
import { initDb } from './db';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRouter);
app.use('/api/photos', photosRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/column', columnRouter);

app.use('/articles', express.static(path.join(__dirname, '../../articles')));
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'TLRphotos API is running', timestamp: new Date().toISOString() });
});

const startServer = async () => {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`TLRphotos backend server running on http://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
