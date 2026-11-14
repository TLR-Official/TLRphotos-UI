/**
 * @file 首页标签板块化作品墙（V4.12.0，PRD 第六节）
 * @description
 *  以三大板块定稿标签为分组维度，每组固定 3×3 网格（最多 9 张，实际不足则自适应），
 *  图片统一 16:9 裁切；空标签组整组不渲染；首屏只渲染第一组，
 *  滚动到当前末尾时通过 IntersectionObserver 提前加载下一组（提前一个标签）。
 *  组标题右侧「⌄」跳转画廊并按该标签筛选。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { CachedImage } from '../../components/CachedImage';
import { TAG_CATALOG } from '../../shared/tagCatalog';
import type { PhotoCategory } from '../../shared/tagCatalog';
import type { PhotoListItem } from '../gallery/types';

interface TagSectionBoardProps {
  /** 已审核照片列表（按上传时间倒序） */
  photos: PhotoListItem[];
}

/** 单组最多展示数量（3×3） */
const GROUP_SIZE = 9;

/** 解析照片的全部标签匹配集合：tags 数组 + structured_tags 的字符串值 */
function buildTagSet(photo: PhotoListItem): Set<string> {
  const result = new Set<string>(photo.tags ?? []);
  const structured = photo.structured_tags;
  if (structured) {
    try {
      const parsed = typeof structured === 'string' ? JSON.parse(structured) : structured;
      if (parsed && typeof parsed === 'object') {
        for (const value of Object.values(parsed as Record<string, unknown>)) {
          if (typeof value === 'string' && value.trim()) result.add(value.trim());
        }
      }
    } catch {
      // 结构化标签损坏时忽略，仅按 tags 数组匹配
    }
  }
  return result;
}

/** 标签分组（同一标签在不同分区可各成一组） */
interface TagGroup {
  key: string;
  category: PhotoCategory;
  tag: string;
  photos: PhotoListItem[];
}

export function TagSectionBoard({ photos }: TagSectionBoardProps) {
  const navigate = useNavigate();
  const [visibleCount, setVisibleCount] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 预解析每张照片的标签集合，避免按「标签 × 照片」重复解析 structured_tags
  const photoTagSets = useMemo(
    () => photos.map((photo) => ({ photo, tagSet: buildTagSet(photo) })),
    [photos],
  );

  // 按标签清单顺序分组，空组过滤
  const groups = useMemo<TagGroup[]>(() => {
    const result: TagGroup[] = [];
    for (const category of Object.keys(TAG_CATALOG) as PhotoCategory[]) {
      for (const tag of TAG_CATALOG[category]) {
        const matched = photoTagSets
          .filter(({ photo, tagSet }) => photo.category === category && tagSet.has(tag))
          .slice(0, GROUP_SIZE)
          .map(({ photo }) => photo);
        if (matched.length > 0) {
          result.push({ key: `${category}:${tag}`, category, tag, photos: matched });
        }
      }
    }
    return result;
  }, [photoTagSets]);

  // 照片数据变化时回到第一组
  useEffect(() => {
    setVisibleCount(1);
  }, [groups.length]);

  // 滚动到已渲染组末尾时提前加载下一组
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= groups.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + 1, groups.length));
        }
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, groups.length]);

  if (groups.length === 0) return null;

  return (
    <section className="mt-16">
      <h2 className="text-xl font-semibold mb-8 text-black">作品板块</h2>
      <div className="space-y-10">
        {groups.slice(0, visibleCount).map((group) => (
          <div key={group.key}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-medium text-gray-900">{group.tag}</h3>
              <button
                type="button"
                onClick={() =>
                  navigate(`/gallery?category=${encodeURIComponent(group.category)}&tag=${encodeURIComponent(group.tag)}`)
                }
                title={`查看「${group.tag}」全部作品`}
                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-700 hover:bg-blue-50 transition-colors"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 md:gap-3">
              {group.photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => navigate(`/photos/${photo.id}`)}
                  title={photo.title}
                  className="group relative aspect-video overflow-hidden rounded-lg bg-gray-100"
                >
                  <CachedImage
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {visibleCount < groups.length && <div ref={sentinelRef} className="h-1" />}
    </section>
  );
}
