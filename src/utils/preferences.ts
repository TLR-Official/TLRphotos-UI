/**
 * @file 用户偏好设置管理（本地存储）
 * @description
 *  将用户偏好持久化到 localStorage，无需后端支持。
 *  核心功能：
 *   1. 提供 UserPreferences 类型与默认值。
 *   2. 读 / 写 / 部分更新 / 重置 / 获取默认值。
 *   3. 解析失败或存储不可用时回退到默认值，保证健壮性。
 *  包含：轮播自动播放、画廊排序、图片懒加载、每页数量等。
 */

// localStorage 存储键名
const STORAGE_KEY = 'tlrphotos_preferences';

/**
 * 用户偏好设置结构
 */
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

// 默认偏好设置
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
 * @returns 当前用户偏好；localStorage 不可用或解析失败时返回默认值
 * @description 使用展开合并确保新增字段在老数据上仍能取到默认值
 */
export function getPreferences(): UserPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(stored);
    // 合并默认值：兼容老版本数据缺失字段
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * 保存偏好设置
 * @param prefs - 完整的偏好设置对象
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
 * @param partial - 仅需提供要修改的字段
 * @returns 合并后的完整偏好设置
 */
export function updatePreferences(partial: Partial<UserPreferences>): UserPreferences {
  const current = getPreferences();
  const updated = { ...current, ...partial };
  savePreferences(updated);
  return updated;
}

/**
 * 重置为默认设置
 * @returns 默认偏好设置
 */
export function resetPreferences(): UserPreferences {
  savePreferences(DEFAULT_PREFERENCES);
  return DEFAULT_PREFERENCES;
}

/**
 * 获取默认设置（返回副本，避免外部修改默认值）
 * @returns 默认偏好设置的副本
 */
export function getDefaultPreferences(): UserPreferences {
  return { ...DEFAULT_PREFERENCES };
}
