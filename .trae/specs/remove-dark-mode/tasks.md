# 移除暗色模式功能 - 实现计划

## [ ] Task 1: 修改 ThemeContext，移除主题切换功能，默认白色模式
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 修改 `src/shared/ThemeContext.tsx`，移除 `toggleTheme` 函数
  - 默认主题设为 `'light'`
  - 移除 localStorage 相关逻辑
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `programmatic` TR-1.1: ThemeContext 导出 `useTheme` 返回固定 `theme: 'light'`
  - `human-judgment` TR-1.2: 代码中不再有暗色模式切换逻辑

## [x] Task 2: 移除 Header 中的主题切换按钮
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 修改 `src/shared/Header.tsx`，移除主题切换按钮（太阳/月亮图标）
  - 移除所有 `theme === 'dark'` 的条件判断，统一使用浅色模式样式
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3
- **Test Requirements**:
  - `human-judgment` TR-2.1: Header 中无主题切换按钮
  - `human-judgment` TR-2.2: Header 样式为白色模式

## [x] Task 3: 修改 MouseFollowBackground 统一白色背景
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 修改 `src/shared/MouseFollowBackground.tsx`，移除主题条件判断
  - 统一使用白色渐变背景和浅色网格纹理
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `human-judgment` TR-3.1: 背景为白色渐变，无深色模式
  - `human-judgment` TR-3.2: 网格纹理颜色适配白色背景

## [ ] Task 4: 修改 App.tsx 移除主题条件判断
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 修改 `src/App.tsx`，移除所有 `theme === 'dark'` 的条件判断
  - 统一使用浅色模式样式
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `human-judgment` TR-4.1: App 组件中无暗色模式条件判断
  - `human-judgment` TR-4.2: 首页轮播图和照片卡片样式正确

## [ ] Task 5: 修改 PhotoDetailPage 移除主题条件判断
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 修改 `src/features/gallery/PhotoDetailPage.tsx`，移除所有 `theme === 'dark'` 的条件判断
  - 统一使用浅色模式样式
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `human-judgment` TR-5.1: 照片详情页无暗色模式样式
  - `human-judgment` TR-5.2: 数据统计、描述等区域样式正确

## [ ] Task 6: 修改 GalleryPage 移除主题条件判断
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 修改 `src/features/gallery/GalleryPage.tsx`，移除所有 `theme === 'dark'` 的条件判断
  - 统一使用浅色模式样式
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `human-judgment` TR-6.1: 作品集页面标签筛选按钮样式正确
  - `human-judgment` TR-6.2: 照片网格样式正确

## [ ] Task 7: 修改 AuthPage 移除主题条件判断
- **Priority**: medium
- **Depends On**: Task 1
- **Description**: 
  - 修改 `src/features/auth/AuthPage.tsx`，移除所有 `theme === 'dark'` 的条件判断
  - 统一使用浅色模式样式
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `human-judgment` TR-7.1: 登录/注册表单样式正确
  - `human-judgment` TR-7.2: 输入框占位符和文字颜色正确

## [ ] Task 8: 修改 ProfilePage/UserProfilePage 移除主题条件判断
- **Priority**: medium
- **Depends On**: Task 1
- **Description**: 
  - 修改 `src/features/profile/ProfilePage.tsx` 和 `UserProfilePage.tsx`，移除所有 `theme === 'dark'` 的条件判断
  - 统一使用浅色模式样式
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `human-judgment` TR-8.1: 用户个人资料页面样式正确
  - `human-judgment` TR-8.2: 公共用户主页样式正确

## [ ] Task 9: 修改 ArticleDetailPage 移除主题条件判断
- **Priority**: medium
- **Depends On**: Task 1
- **Description**: 
  - 修改 `src/features/column/ArticleDetailPage.tsx`，移除所有 `theme === 'dark'` 的条件判断
  - 统一使用浅色模式样式
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `human-judgment` TR-9.1: 文章详情页样式正确
  - `human-judgment` TR-9.2: 评论区和点赞区域样式正确

## [ ] Task 10: 清理 CSS 中的暗色模式样式
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 修改 `src/index.css`，移除暗色模式相关样式（`.page-dark`, `.glass`, `.theme-bg-transition`, 等）
  - 保留浅色模式样式，确保白色模式正常工作
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `human-judgment` TR-10.1: CSS 中无暗色模式专属样式
  - `human-judgment` TR-10.2: 页面样式正常渲染

## [ ] Task 11: 编译测试
- **Priority**: high
- **Depends On**: 所有任务
- **Description**: 
  - 执行前端构建命令，验证编译通过
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - `programmatic` TR-11.1: `npm run build` 成功，无错误
