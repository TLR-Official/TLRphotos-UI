/**
 * @file 传图 / 网站规则页（V4.13.0，PRD 8.2；V4.15.0 Q14 改为后台维护）
 * @description
 *  规则文件链接由后台「站点内容」维护（默认指向 public/rule-files/ 下的静态 PDF），
 *  前端通过公开接口读取已上线文件；点击卡片在新标签页打开浏览器原生 PDF 预览，同时提供下载入口。
 *  更新流程：后台上线新链接并下线旧链接即可，无需重新构建前端。
 *  注意：静态目录不能命名为 rules，否则会与 SPA 的 /rules 路由冲突（nginx 目录 301 → 403）。
 */
import { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { getRuleFiles } from '../../api/siteContent';
import type { RuleFile } from '../../api/siteContent';

export function RulesPage() {
  const [files, setFiles] = useState<RuleFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    getRuleFiles().then((res) => {
      if (res.success && res.data) {
        setFiles(res.data);
      } else {
        setErrorMessage(res.message || '规则文件加载失败，请稍后刷新重试');
      }
      setIsLoading(false);
    });
  }, []);

  return (
    <div className="px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-black">传图 / 网站规则</h1>
        <p className="mt-2 text-gray-600">点击下方文件查看规则。</p>

        {isLoading ? (
          <p className="mt-8 text-sm text-gray-500">规则文件加载中…</p>
        ) : errorMessage ? (
          <p className="mt-8 text-sm text-red-500">{errorMessage}</p>
        ) : files.length === 0 ? (
          <p className="mt-8 text-sm text-gray-500">暂无规则文件，请稍后再来查看。</p>
        ) : (
          <div className="mt-8 space-y-4">
            {files.map((file) => (
              <div
                key={file.id}
                className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-4 min-w-0">
                  <div className="h-11 w-11 flex-shrink-0 rounded-lg bg-blue-50 flex items-center justify-center">
                    <FileText className="h-6 w-6 text-blue-700" />
                  </div>
                  <div className="min-w-0">
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-gray-900 hover:text-blue-700 transition-colors"
                    >
                      {file.title}
                    </a>
                    {file.description && (
                      <p className="mt-1 text-sm text-gray-600 leading-relaxed">{file.description}</p>
                    )}
                    <p className="mt-2 text-xs text-gray-400">
                      {[file.version_text, 'PDF', file.size_text].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:flex-shrink-0">
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-800"
                  >
                    查看规则
                  </a>
                  <a
                    href={file.url}
                    download
                    aria-label={`下载${file.title}`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors hover:border-blue-700 hover:text-blue-700"
                  >
                    <Download className="h-5 w-5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 text-xs text-gray-400">
          规则更新将在站内公告；如对规则有疑问，可通过「关于我们」页面的联系方式与站方沟通。
        </p>
      </div>
    </div>
  );
}
