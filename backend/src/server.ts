import express from 'express';
import cors from 'cors';
import path from 'path';
import photosRouter from './routes/photos';
import articlesRouter from './routes/articles';
import columnRouter from './routes/column';
import { initDb } from './db';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/photos', photosRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/column', columnRouter);

app.use('/articles', express.static(path.join(__dirname, '../../articles')));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'TLRphotos API is running', timestamp: new Date().toISOString() });
});

const startServer = async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`TLRphotos backend server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
