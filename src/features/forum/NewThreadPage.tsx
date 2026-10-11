/** 发帖页（V3.1.0） */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { getBoards, createThread } from '../../api/forum';
import { useHumanVerification } from '../../shared/useHumanVerification';
import { useUser } from '../../shared/UserContext';
import type { Board } from './types';

export function NewThreadPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useUser();
  const { guard, modal } = useHumanVerification({ title: '发帖验证' });
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState(searchParams.get('board_id') || '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated) navigate('/auth');
    getBoards().then((r) => {
      if (r.success && r.data) {
        setBoards(r.data);
        if (!boardId && r.data.length > 0) setBoardId(r.data[0].id);
      }
    });
  }, [isAuthenticated]);

  const handleSubmit = async () => {
    setError('');
    if (!boardId) { setError('请选择板块'); return; }
    if (!title.trim()) { setError('请输入标题'); return; }
    if (title.length > 120) { setError('标题不能超过 120 字'); return; }
    if (!content.trim()) { setError('请输入正文'); return; }
    if (content.length > 20000) { setError('正文不能超过 20000 字'); return; }

    setSubmitting(true);
    const result = await guard('thread_create', () =>
      createThread({ board_id: boardId, title: title.trim(), content_md: content })
    );
    setSubmitting(false);
    if (result.success) {
      navigate(`/forum/t/${result.data!.id}`);
    } else {
      setError(result.message || '发帖失败');
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
        <Link to="/forum" className="hover:text-teal-600">论坛</Link>
        <span>/</span>
        <span className="text-slate-700">发帖</span>
      </div>

      <h1 className="text-xl font-bold text-slate-800 mb-6">发布新帖</h1>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-slate-600 mb-1">板块</label>
          <select
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:border-teal-400"
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>{b.icon} {b.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1">标题 <span className="text-slate-400">({title.length}/120)</span></label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="请输入帖子标题"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-teal-400"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm text-slate-600">正文 <span className="text-slate-400">({content.length}/20000)</span></label>
            <button
              onClick={() => setShowPreview((v) => !v)}
              className="text-xs text-teal-600 hover:text-teal-700"
            >
              {showPreview ? '编辑' : '预览'}
            </button>
          </div>
          {showPreview ? (
            <div className="w-full min-h-[200px] p-3 border border-slate-200 rounded-lg prose prose-sm max-w-none">
              {content.trim() ? <ReactMarkdown>{content}</ReactMarkdown> : <span className="text-slate-300">暂无内容</span>}
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={20000}
              placeholder="支持 Markdown 语法…"
              className="w-full min-h-[200px] px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-teal-400 resize-y font-mono text-sm"
            />
          )}
        </div>

        {error && <div className="text-sm text-red-500">{error}</div>}

        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors font-medium"
          >
            {submitting ? '发布中…' : '发布'}
          </button>
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
          >
            取消
          </button>
        </div>
      </div>

      {modal}
    </div>
  );
}
