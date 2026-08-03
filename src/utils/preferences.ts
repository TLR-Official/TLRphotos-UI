/**
 * 用户偏好设置管理（本地存储）
 *
 * 存储在 localStorage 中，不需要后端支持。
 * 包含：轮播自动播放、画廊排序、图片懒加载、每页数量等。
 */

const STORAGE_KEY = 'tlrphotos_preferences';

export interface UserPreferences {
  carouselAutoplay: boolean;     // 轮播图自动播放
  carouselInterval: number;      // 轮播切换间隔（毫秒）
  gallerySortBy: string;         // 画廊默认排序
  gallerySortOrder: 'asc' | 'desc'; // 排序方向
  imageLazyLoad: boolean;        // 图片懒加载
  pageSize: number;              // 每页加载数量
  showTagsInGallery: boolean;    // 画廊中显示标签
  preloadImages: boolean;        // 预加载图片
}

const DEFAULT_PREFERENCES: UserPreferences = {
  carouselAutoplay: true,
  carouselInterval: 4000,
  gallerySortBy: 'created_at',
  gallerySortOrder: 'desc',
  imageLazyLoad: true,
  pageSize: 24,
  showTagsInGallery: true,
  preloadImages: true,
};

/**
 * 读取偏好设置
 */
export function getPreferences(): UserPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(stored);
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * 保存偏好设置
 */
export function savePreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 不可用时静默失败
  }
}

/**
 * 更新部分偏好设置
 */
export function updatePreferences(partial: Partial<UserPreferences>): UserPreferences {
  const current = getPreferences();
  const updated = { ...current, ...partial };
  savePreferences(updated);
  return updated;
}

/**
 * 重置为默认设置
 */
export function resetPreferences(): UserPreferences {
  savePreferences(DEFAULT_PREFERENCES);
  return DEFAULT_PREFERENCES;
}

/**
 * 获取默认设置
 */
export function getDefaultPreferences(): UserPreferences {
  return { ...DEFAULT_PREFERENCES };
}
