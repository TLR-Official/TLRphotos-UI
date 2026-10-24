/** 发帖页（V3.1.0）；移动端：Markdown 工具栏默认收起（Aa 展开）、编辑/预览 Tab、提交按钮通栏 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { getBoards, createThread } from '../../api/forum';
import { useHumanVerification } from '../../shared/useHumanVerification';
import { useIsMobile } from '../../shared/useIsMobile';
import { useUser } from '../../shared/UserContext';
import type { Board } from './types';

/** 移动端 Markdown 工具栏项：before/after 包裹选区，无选区时插入 placeholder */
const MD_TOOLS: { label: string; before: string; after?: string; placeholder?: string }[] = [
  { label: '加粗', before: '**', after: '**', placeholder: '粗体' },
  { label: '斜体', before: '*', after: '*', placeholder: '斜体' },
  { label: '标题', before: '## ', placeholder: '标题' },
  { label: '引用', before: '> ', placeholder: '引用' },
  { label: '列表', before: '- ', placeholder: '列表项' },
  { label: '代码', before: '`', after: '`', placeholder: '代码' },
  { label: '链接', before: '[', after: '](https://)', placeholder: '链接文字' },
];

/** 正文最大长度（与提交校验一致） */
const CONTENT_MAX = 20000;

export function NewThreadPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useUser();
  const { guard, modal } = useHumanVerification({ title: '发帖验证' });
  const isMobile = useIsMobile();
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState(searchParams.get('board_id') || '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [showMdTools, setShowMdTools] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isAuthenticated) navigate('/auth');
    getBoards().then((r) => {
      if (r.success && r.data) {
        setBoards(r.data);
        if (!boardId && r.data.length > 0) setBoardId(r.data[0].id);
      }
    });
  }, [isAuthenticated]);

  /** 在光标处包裹/插入 Markdown 语法（移动端工具栏），插入后光标落于内容末尾 */
  const insertMarkdown = (before: string, after = '', placeholder = '') => {
    const ta = contentRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end) || placeholder;
    const next = content.slice(0, start) + before + selected + after + content.slice(end);
    if (next.length > CONTENT_MAX) return;
    setContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      const caret = start + before.length + selected.length + after.length;
      ta.setSelectionRange(caret, caret);
    });
  };

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
        <Link to="/forum" className="hover:text-blue-700">论坛</Link>
        <span>/</span>
        <span className="text-slate-700">发帖</span>
      </div>

      <h1 className="text-xl font-bold text-black mb-6">发布新帖</h1>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-slate-600 mb-1">板块</label>
          <select
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:border-blue-700 max-md:py-3"
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
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
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700 max-md:py-3"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm text-slate-600">正文 <span className="text-slate-400">({content.length}/20000)</span></label>
            {isMobile ? (
              /* 移动端：Aa 文字按钮展开/收起 Markdown 工具栏（默认收起），热区 44px */
              <button
                type="button"
                onClick={() => setShowMdTools((v) => !v)}
                aria-expanded={showMdTools}
                aria-label="Markdown 工具栏"
                className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-sm font-medium ${showMdTools ? 'text-blue-700' : 'text-slate-500'}`}
              >
                Aa
              </button>
            ) : (
              <button
                onClick={() => setShowPreview((v) => !v)}
                className="text-xs text-blue-700 hover:text-blue-800"
              >
                {showPreview ? '编辑' : '预览'}
              </button>
            )}
          </div>

          {/* 移动端：编辑/预览 Tab 置于编辑器上方 */}
          {isMobile && (
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className={`h-11 flex-1 rounded-lg text-sm font-medium ${!showPreview ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                className={`h-11 flex-1 rounded-lg text-sm font-medium ${showPreview ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                预览
              </button>
            </div>
          )}

          {/* 移动端：Markdown 工具栏（仅编辑态可见） */}
          {isMobile && showMdTools && !showPreview && (
            <div className="flex flex-wrap gap-2 mb-2">
              {MD_TOOLS.map((tool) => (
                <button
                  key={tool.label}
                  type="button"
                  onClick={() => insertMarkdown(tool.before, tool.after ?? '', tool.placeholder ?? '')}
                  className="h-11 min-w-[44px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 active:bg-slate-100"
                >
                  {tool.label}
                </button>
              ))}
            </div>
          )}

          {showPreview ? (
            <div className="w-full min-h-[200px] p-3 border border-slate-200 rounded-lg prose prose-sm max-w-none">
              {content.trim() ? <ReactMarkdown>{content}</ReactMarkdown> : <span className="text-slate-300">暂无内容</span>}
            </div>
          ) : (
            <textarea
              ref={contentRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={20000}
              placeholder="支持 Markdown 语法…"
              className="w-full min-h-[200px] px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700 resize-y font-mono text-sm"
            />
          )}
        </div>

        {error && <div className="text-sm text-red-500">{error}</div>}

        {/* 提交区：移动端按钮通栏 h-12，pb-safe 预留底部安全区；人机验证沿用 guard 弹窗（Turnstile ≤360px 自动 compact） */}
        <div className="flex gap-3 max-md:flex-col pb-safe">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium max-md:w-full max-md:h-12"
          >
            {submitting ? '发布中…' : '发布'}
          </button>
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 max-md:w-full max-md:h-12"
          >
            取消
          </button>
        </div>
      </div>

      {modal}
    </div>
  );
}
