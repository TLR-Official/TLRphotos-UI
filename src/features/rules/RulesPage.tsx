/**
 * @file 传图 / 网站规则页（V4.13.0，PRD 8.2）
 * @description
 *  以 PDF 文件承载传图规则与网站规则，桌面端顶栏与移动端「我的」功能列表提供入口。
 *  规则文件放在 public/rules/ 下，按静态资源分发；点击卡片在新标签页打开浏览器原生 PDF 预览，
 *  同时提供下载入口。规则更新时替换 PDF 即可，无需改代码。
 */
import { Download, FileText } from 'lucide-react';

/** 规则文件定义（静态配置，不建表） */
interface RuleFile {
  /** 文件标题 */
  title: string;
  /** 一句话说明 */
  description: string;
  /** public 下的绝对路径 */
  href: string;
  /** 文件体积展示文案 */
  size: string;
  /** 版本与更新日期 */
  version: string;
}

const RULE_FILES: RuleFile[] = [
  {
    title: 'TLRphotos 传图规则',
    description: '作品要求、分区必填信息、标签规范、审核与申诉、版权许可与热门推荐。',
    href: '/rules/upload-rules.pdf',
    size: '约 466 KB',
    version: '2026-11 版',
  },
  {
    title: 'TLRphotos 网站规则',
    description: '账户与资料、社区行为、三级处罚体系、内容与隐私、作品许可与数据清理。',
    href: '/rules/site-rules.pdf',
    size: '约 433 KB',
    version: '2026-11 版',
  },
];

export function RulesPage() {
  return (
    <div className="px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-black">传图 / 网站规则</h1>
        <p className="mt-2 text-gray-600">点击下方文件查看规则。</p>

        <div className="mt-8 space-y-4">
          {RULE_FILES.map((file) => (
            <div
              key={file.href}
              className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-4 min-w-0">
                <div className="h-11 w-11 flex-shrink-0 rounded-lg bg-blue-50 flex items-center justify-center">
                  <FileText className="h-6 w-6 text-blue-700" />
                </div>
                <div className="min-w-0">
                  <a
                    href={file.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-gray-900 hover:text-blue-700 transition-colors"
                  >
                    {file.title}
                  </a>
                  <p className="mt-1 text-sm text-gray-600 leading-relaxed">{file.description}</p>
                  <p className="mt-2 text-xs text-gray-400">
                    {file.version} · PDF · {file.size}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:flex-shrink-0">
                <a
                  href={file.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-800"
                >
                  查看规则
                </a>
                <a
                  href={file.href}
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

        <p className="mt-8 text-xs text-gray-400">
          规则更新将在站内公告；如对规则有疑问，可通过「关于我们」页面的联系方式与站方沟通。
        </p>
      </div>
    </div>
  );
}
