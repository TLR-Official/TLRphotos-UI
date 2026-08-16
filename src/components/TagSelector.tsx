/**
 * 标签选择器组件
 * 根据传入的分区 ID 加载该分区下的标签对象列表，渲染为可点击选择的卡片。
 * 选中后展开属性输入表单（select 类型渲染下拉框，其他类型渲染 input）。
 * 该组件从 UploadPage 提取，去除了 dark mode 样式，保持白色背景黑色字体的视觉风格。
 */
import { useState, useEffect } from 'react';
import { getCategoryTags } from '../api/tags';
import type { TagObject } from '../api/tags';

/** 已选标签（含标签对象 id、名称及其属性键值对） */
export interface SelectedTag {
  objectId: string;
  objectName: string;
  attributes: Record<string, string>;
}

interface TagSelectorProps {
  /** 当前选中的分区 ID，变化时重新加载该分区的标签对象列表 */
  categoryId: string;
  /** 当前已选标签列表（受控） */
  selectedTags: SelectedTag[];
  /** 标签变化回调 */
  onTagsChange: (tags: SelectedTag[]) => void;
  /** 是否禁用交互（如上传中） */
  disabled?: boolean;
}

/**
 * 标签选择器
 * @param props - 见 TagSelectorProps
 * @returns 标签卡片列表 JSX
 */
export function TagSelector({ categoryId, selectedTags, onTagsChange, disabled }: TagSelectorProps) {
  const [objects, setObjects] = useState<TagObject[]>([]);

  // categoryId 变化时拉取该分区的标签对象列表
  useEffect(() => {
    let cancelled = false;
    getCategoryTags(categoryId).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) {
        setObjects(res.data.objects);
      } else {
        setObjects([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  /**
   * 切换标签选中状态
   * 已选则移除，未选则追加（初始属性为空对象）。
   */
  const handleToggle = (objectId: string, objectName: string) => {
    if (disabled) return;
    const existing = selectedTags.find((t) => t.objectId === objectId);
    if (existing) {
      onTagsChange(selectedTags.filter((t) => t.objectId !== objectId));
    } else {
      onTagsChange([...selectedTags, { objectId, objectName, attributes: {} }]);
    }
  };

  /**
   * 更新某标签下指定属性的值
   */
  const handleAttributeChange = (objectId: string, attrKey: string, value: string) => {
    if (disabled) return;
    onTagsChange(
      selectedTags.map((tag) =>
        tag.objectId === objectId ? { ...tag, attributes: { ...tag.attributes, [attrKey]: value } } : tag
      )
    );
  };

  // 与上传页保持一致的输入框样式：白底黑字，聚焦时蓝色边框
  const inputCls =
    'w-full px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

  if (objects.length === 0) {
    return (
      <div className="mt-2 text-sm text-gray-400 py-4 text-center bg-gray-50 rounded-lg border border-gray-200">
        该分区暂无可用标签
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      {objects.map((obj) => {
        const isSelected = selectedTags.some((t) => t.objectId === obj.id);
        return (
          <div
            key={obj.id}
            className={`rounded-lg border p-3 cursor-pointer transition-all ${
              isSelected
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-gray-50 hover:border-gray-300'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            onClick={() => handleToggle(obj.id, obj.name)}
          >
            <div className="flex items-center justify-between">
              <span className={`font-medium ${isSelected ? 'text-blue-600' : 'text-gray-700'}`}>
                {obj.name}
              </span>
              <span
                className={`text-sm px-2 py-1 rounded ${
                  isSelected ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {isSelected ? '已选择' : '点击选择'}
              </span>
            </div>
            {obj.description && (
              <p className="text-xs mt-1 text-gray-500">{obj.description}</p>
            )}
            {isSelected && obj.attributes.length > 0 && (
              <div className="mt-3 space-y-2">
                {obj.attributes.map((attr) => {
                  const currentValue =
                    selectedTags.find((t) => t.objectId === obj.id)?.attributes[attr.key] || '';
                  return (
                    <div key={attr.id}>
                      <span className="text-xs text-gray-500">{attr.label}</span>
                      {attr.type === 'select' ? (
                        <select
                          value={currentValue}
                          onChange={(e) => handleAttributeChange(obj.id, attr.key, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={disabled}
                          className={`${inputCls} mt-1`}
                        >
                          <option value="">请选择</option>
                          {attr.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={attr.type}
                          value={currentValue}
                          onChange={(e) => handleAttributeChange(obj.id, attr.key, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={disabled}
                          placeholder={`请输入${attr.label}`}
                          className={`${inputCls} mt-1`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
