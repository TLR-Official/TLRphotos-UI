/**
 * @file 上传标签多选组件（V4.11）
 * @description
 *  以 docs PRD 定稿的标签清单为数据源：桌面端渲染复选框，移动端渲染 ≥44px 的大按钮，
 *  移动端标签较多时折叠为「更多」展开。选中值即标签名称数组，直接作为上传 tags 提交。
 */
import { useState } from 'react';
import { useIsMobile } from '../../shared/useIsMobile';

interface TagPickerProps {
  /** 当前分区标签清单（顺序即展示顺序） */
  tags: readonly string[];
  /** 已选标签名 */
  selected: string[];
  /** 变更回调 */
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/** 移动端折叠状态下展示的标签数量 */
const MOBILE_COLLAPSED_COUNT = 8;

export function TagPicker({ tags, selected, onChange, disabled = false }: TagPickerProps) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);

  const toggle = (tag: string) => {
    if (disabled) return;
    if (selected.includes(tag)) {
      onChange(selected.filter((item) => item !== tag));
    } else {
      onChange([...selected, tag]);
    }
  };

  if (isMobile) {
    const visibleTags = expanded ? tags : tags.slice(0, MOBILE_COLLAPSED_COUNT);
    return (
      <div className="mt-2">
        <div className="flex flex-wrap gap-2">
          {visibleTags.map((tag) => {
            const active = selected.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => toggle(tag)}
                className={`min-h-[44px] rounded-lg border px-3 text-sm transition-colors disabled:opacity-50 ${
                  active
                    ? 'border-blue-700 bg-blue-50 font-medium text-blue-700'
                    : 'border-gray-200 bg-white text-gray-700'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
        {tags.length > MOBILE_COLLAPSED_COUNT && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-1 inline-flex min-h-[44px] items-center text-sm text-blue-700"
          >
            {expanded ? '收起' : `更多（${tags.length - MOBILE_COLLAPSED_COUNT}）`}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
      {tags.map((tag) => {
        const active = selected.includes(tag);
        return (
          <label
            key={tag}
            className={`flex items-center gap-2 text-sm ${
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer text-gray-700'
            }`}
          >
            <input
              type="checkbox"
              checked={active}
              disabled={disabled}
              onChange={() => toggle(tag)}
              className="h-4 w-4 accent-blue-700"
            />
            <span className={active ? 'font-medium text-blue-700' : ''}>{tag}</span>
          </label>
        );
      })}
    </div>
  );
}
