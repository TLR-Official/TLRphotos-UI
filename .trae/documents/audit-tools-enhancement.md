# 审核界面增强工具集实现计划

## Summary

为管理后台照片审核详情页（`src/admin/PhotoDetailPage.tsx`）增加一套功能完整的图像分析工具集，包含 9 项工具：直方图（曝光+三色）、九宫格辅助线、脏污点检测、对比度量化、无极缩放、饱和度分析、锐度评估、色温分析、高光/暗部溢出警告。所有工具基于原生 Canvas API 实现客户端分析，支持快捷键操作，工具面板可折叠自定义。

## Current State Analysis

### 现有审核详情页结构

* **文件**：`src/admin/PhotoDetailPage.tsx`

* **布局**：`grid grid-cols-1 lg:grid-cols-3 gap-6`，左侧 `lg:col-span-2` 是图片预览（`max-h-[600px] object-contain`），右侧是上传者信息/EXIF/水印配置卡片

* **图片容器**：`<div className="bg-white rounded-xl overflow-hidden border border-gray-200">` 包裹 `<CachedImage>`

* **图片选择**：`mainImage = photo.watermarked_url || photo.preview_url || photo.original_url`，通过 `authToken={adminToken}` + `cacheEnabled={false}` 加载

### 图片加载机制

* **CachedImage**：通过 `getCachedImage(src, headers)` 获取图片，返回 `blob:` ObjectURL

* **鉴权**：管理员 token 通过 `Authorization: Bearer ${authToken}` 请求需鉴权的未审核图片

* **关键约束**：工具集需要获取像素数据做 Canvas 分析，必须复用相同的鉴权路径获取图片 Blob

### 技术栈

* React 19 + TypeScript + Tailwind CSS 4

* `lucide-react` 图标库（已有）

* `exifr` EXIF 解析（已有）

* **无 Canvas/图像处理库** → 用原生 Canvas 2D API 实现

* **无快捷键处理** → 新建 `useKeyboardShortcuts` hook

### 设计系统

* 主色：紫色 accent `#aa3bff` / Tailwind `purple-600`

* 卡片：`rounded-xl p-4 bg-gray-50 border border-gray-100`

* 按钮：`bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors`

* 字体：system-ui

## Proposed Changes

### 文件结构（新增）

```
src/admin/audit-tools/
├── index.ts                          # 公共导出
├── AuditToolkit.tsx                  # 工具集主容器组件（工具栏 + 面板 + 叠加层）
├── hooks/
│   ├── useImagePixels.ts             # 核心 hook：获取图片像素数据（Canvas + 降采样）
│   └── useKeyboardShortcuts.ts       # 快捷键处理 hook
├── components/
│   ├── AuditToolbar.tsx              # 工具栏（图标按钮组，可折叠）
│   ├── ToolPanel.tsx                 # 工具面板容器（右侧抽屉，可折叠）
│   └── CanvasOverlay.tsx             # 叠加层容器（九宫格/对角线/斑马纹/脏污点标记）
├── tools/
│   ├── HistogramTool.tsx             # 曝光+三色直方图（RGB）
│   ├── GridOverlayTool.tsx           # 九宫格 + 对角线辅助线
│   ├── BlemishDetectorTool.tsx       # 脏污点智能检测
│   ├── ContrastTool.tsx              # 对比度量化
│   ├── ZoomTool.tsx                  # 无极缩放（滚轮 + 按钮）
│   ├── SaturationTool.tsx            # 饱和度分析
│   ├── SharpnessTool.tsx             # 锐度评估（拉普拉斯方差）[扩展1]
│   ├── ColorTempTool.tsx             # 色温分析（RGB 通道均值偏移）[扩展2]
│   └── ClippingWarningTool.tsx       # 高光/暗部溢出警告（斑马纹）[扩展3]
└── types.ts                          # 工具类型定义
```

### 修改文件（仅1处集成）

**`src/admin/PhotoDetailPage.tsx`**：在大图预览容器内集成 `<AuditToolkit>`，替换现有的 `<CachedImage>` 直接渲染。工具集组件接管图片渲染（内部复用 CachedImage 逻辑），在其上叠加分析层。

### 核心实现方案

#### 1. `useImagePixels` hook（图像像素数据获取）

```typescript
// hooks/useImagePixels.ts
interface ImagePixelsResult {
  imageData: ImageData | null;      // 降采样后的像素数据
  naturalWidth: number;             // 原图宽度
  naturalHeight: number;            // 原图高度
  loading: boolean;
  error: string | null;
}
```

* 接收 `src` + `authToken`，通过 `getCachedImage(src, headers)` 获取 blob URL

* 加载到 `Image` 对象 → 绘制到离屏 `<canvas>`（降采样至最大 800px 长边，保证 <200ms）

* 调用 `ctx.getImageData(0, 0, w, h)` 获取像素数据

* 用 `useMemo` 缓存，src 变化时重新计算

* **性能保证**：800px 降采样后约 64 万像素，直方图/对比度/饱和度计算 < 30ms

#### 2. 各工具实现摘要

| 工具           | 实现方式                                                                  | 数据来源             | 快捷键 |
| ------------ | --------------------------------------------------------------------- | ---------------- | --- |
| **曝光+三色直方图** | Canvas 绘制 RGB 三通道柱状图（256 bin）                                         | `useImagePixels` | `H` |
| **九宫格辅助线**   | CSS overlay 绝对定位 div 绘制 3×3 网格 + 对角线 SVG                              | 图片容器尺寸           | `G` |
| **脏污点检测**    | 局部方差异常检测：对降采样图分块（16×16），计算每块方差，低于阈值的平滑块在梯度异常处标记红框                     | `useImagePixels` | `B` |
| **对比度量化**    | 计算亮度标准差 + RMS 对比度，显示数值 + 参考标准（低<40/中40-80/高>80）                       | `useImagePixels` | `C` |
| **无极缩放**     | CSS `transform: scale()` + `transform-origin` 跟随鼠标，滚轮缩放(0.1x-8x)，拖拽平移 | 容器 ref           | `Z` |
| **饱和度分析**    | RGB→HSL 转换，计算平均饱和度 + 可视化色环                                            | `useImagePixels` | `S` |
| **锐度评估**     | 拉普拉斯算子卷积方差（Laplacian Variance），数值越高越清晰                                | `useImagePixels` | `R` |
| **色温分析**     | 计算 R/B 通道均值比，偏红=暖色温，偏蓝=冷色温，显示色温条                                      | `useImagePixels` | `T` |
| **高光/暗部溢出**  | 标记 RGB 均>245（高光）或 <10（暗部）的像素，叠加斑马纹                                    | `useImagePixels` | `L` |

#### 3. `useKeyboardShortcuts` hook

```typescript
// hooks/useKeyboardShortcuts.ts
function useKeyboardShortcuts(
  handlers: Record<string, () => void>,
  options: { enabled: boolean }
): void
```

* 监听 `keydown` 事件，匹配单字母快捷键

* 在输入框聚焦时自动禁用（`document.activeElement` 判断 `tagName`）

* 支持 `Escape` 关闭所有叠加层

#### 4. `AuditToolkit` 主容器组件

```tsx
// AuditToolkit.tsx
interface AuditToolkitProps {
  src: string;
  authToken?: string;
  alt: string;
  className: string;  // 透传给内部 CachedImage
}
```

**布局**：

```
┌─────────────────────────────────────────┐
│ [📊H] [▦G] [⚡B] [◐C] [🔍Z] [🎨S] [⬡R] [🌡T] [⚠L] [⚙] │  ← 工具栏（图标按钮组）
├─────────────────────────────────────────┤
│                                         │
│         图片预览 + 叠加层               │  ← 图片容器
│    (九宫格/斑马纹/脏污标记 叠加在此)     │
│                                         │
├─────────────────────────────────────────┤
│ [尺寸] [浏览数] [点赞数] [水印状态]      │  ← 保留原有图片操作栏
└─────────────────────────────────────────┘

工具面板（按需从右侧滑出）:
┌──────────┐
│ 直方图   │  ← 选中工具时显示对应面板
│ ████ █   │
│ ██████   │
└──────────┘
```

* 工具栏：图片容器上方一行图标按钮（lucide-react 图标）

* 叠加工具（九宫格/斑马纹/脏污点）：用 `<CanvasOverlay>` 绝对定位覆盖图片

* 数据工具（直方图/对比度/饱和度/锐度/色温）：点击后在图片右侧滑出 `ToolPanel`

* 缩放工具：直接作用于图片容器（transform + 滚轮），不显示面板

* 工具栏可折叠（`⚙` 按钮或快捷键 `~`），折叠时只显示一行精简按钮

#### 5. 快捷键清单

| 键       | 工具             | 说明              |
| ------- | -------------- | --------------- |
| `H`     | Histogram      | 切换直方图面板         |
| `G`     | Grid           | 切换九宫格叠加         |
| `D`     | Diagonal       | 切换对角线叠加（与 G 配合） |
| `B`     | Blemish        | 切换脏污点检测         |
| `C`     | Contrast       | 切换对比度面板         |
| `Z`     | Zoom           | 激活缩放模式（滚轮缩放）    |
| `S`     | Saturation     | 切换饱和度面板         |
| `R`     | Sharpness      | 切换锐度面板          |
| `T`     | Temperature    | 切换色温面板          |
| `L`     | cLipping       | 切换溢出警告          |
| `~`     | Toggle Toolbar | 折叠/展开工具栏        |
| `Esc`   | Close All      | 关闭所有面板和叠加层      |
| `0`     | Reset Zoom     | 重置缩放            |
| `+`/`-` | Zoom In/Out    | 放大/缩小           |

#### 6. 视觉风格一致性

* 工具栏按钮：`p-2 rounded-lg hover:bg-purple-50 text-gray-600 hover:text-purple-600 transition-colors`，激活状态 `bg-purple-100 text-purple-700`

* 工具面板：`bg-white rounded-xl border border-gray-200 shadow-xl`，宽度 `w-80`

* 叠加线：`border-purple-500/70`（九宫格）、`stroke-purple-500`（对角线 SVG）

* 数据数值：`text-2xl font-bold text-gray-800`

* 参考标准条：绿色/黄色/红色三段渐变指示

## Assumptions & Decisions

### 技术决策

1. **客户端分析**：所有图像分析在前端 Canvas 完成，不增加后端负载。理由：审核员需要实时交互，后端分析会增加网络延迟。
2. **降采样分析**：像素分析基于降采样至 800px 长边的图像，保证 <200ms 响应。理由：全分辨率像素分析（4000×3000 = 1200万像素）可能耗时 200-500ms，降采样后精度足够用于质量评估。
3. **无 Web Worker**：降采样后计算量已足够小（<30ms），Web Worker 的通信开销反而不利。保持简单。
4. **复用 CachedImage 鉴权路径**：工具集内部通过 `getCachedImage(src, headers)` 获取 blob，与 CachedImage 一致，确保能访问未审核图片。
5. **CSS transform 缩放**：缩放用 CSS `transform: scale()` 而非 Canvas 重绘，GPU 加速，流畅度高。

### 扩展功能选择理由（用户要求至少3项）

1. **锐度评估**：航空摄影常有动态模糊，审核员需判断是否清晰可发布
2. **色温分析**：交通摄影场景色温准确性影响画面真实感，需判断白平衡
3. **高光/暗部溢出警告**：天空/阴影区域细节丢失是常见驳回原因，斑马纹直观提示

### 工具集独立性

* 工具集是独立模块（`src/admin/audit-tools/`），不修改 CachedImage、imageCache 等共享组件

* 仅在 PhotoDetailPage.tsx 集成一处，替换图片渲染区域

* 所有工具面板和叠加层使用绝对/固定定位，不破坏现有页面布局

## Implementation Steps

### Step 1: 创建类型定义和核心 hooks

* 新建 `src/admin/audit-tools/types.ts`：定义 `ToolId`、`AuditToolkitProps` 等类型

* 新建 `src/admin/audit-tools/hooks/useImagePixels.ts`：核心像素数据获取 hook

* 新建 `src/admin/audit-tools/hooks/useKeyboardShortcuts.ts`：快捷键处理 hook

### Step 2: 创建工具栏和面板容器

* 新建 `src/admin/audit-tools/components/AuditToolbar.tsx`：图标按钮组工具栏

* 新建 `src/admin/audit-tools/components/ToolPanel.tsx`：右侧滑出面板容器

* 新建 `src/admin/audit-tools/components/CanvasOverlay.tsx`：叠加层容器

### Step 3: 实现数据类工具（5个）

* `tools/HistogramTool.tsx`：RGB 三通道直方图（Canvas 绘制柱状图）

* `tools/ContrastTool.tsx`：对比度量化（亮度标准差 + RMS）

* `tools/SaturationTool.tsx`：饱和度分析（HSL 转换 + 色环可视化）

* `tools/SharpnessTool.tsx`：锐度评估（拉普拉斯方差）

* `tools/ColorTempTool.tsx`：色温分析（R/B 均值比 + 色温条）

### Step 4: 实现叠加类工具（3个）

* `tools/GridOverlayTool.tsx`：九宫格 + 对角线（CSS/SVG overlay）

* `tools/BlemishDetectorTool.tsx`：脏污点检测（分块方差 + Canvas 标记）

* `tools/ClippingWarningTool.tsx`：高光/暗部溢出（斑马纹 Canvas overlay）

### Step 5: 实现缩放工具

* `tools/ZoomTool.tsx`：CSS transform 缩放 + 滚轮控制 + 拖拽平移

### Step 6: 集成主容器组件

* 新建 `src/admin/audit-tools/AuditToolkit.tsx`：整合工具栏、面板、叠加层、图片渲染

* 新建 `src/admin/audit-tools/index.ts`：公共导出

* **修改** **`src/admin/PhotoDetailPage.tsx`**：替换大图区域的 `<CachedImage>` 为 `<AuditToolkit>`，保留原有图片操作栏

### Step 7: 快捷键面板

* 在工具面板中添加快捷键提示卡片（`?` 键打开完整快捷键列表浮层）

### Step 8: 构建验证 + 更新 Changelog + Git 提交

## Verification Steps

1. **构建验证**：`npm run build` 通过（TypeScript 类型检查 + Vite 打包）
2. **Lint 检查**：`npm run lint` 通过
3. **功能测试（浏览器手动验证）**：

   * 打开 `/admin/photos/:id` 详情页，确认工具栏显示在图片上方

   * 按 `H` 键，确认直方图面板从右侧滑出，显示 RGB 三通道柱状图

   * 按 `G` 键，确认九宫格叠加在图片上

   * 按 `Z` 键激活缩放，用滚轮放大图片，确认平滑无卡顿

   * 按 `B` 键，确认脏污点检测在图片上标记红框

   * 按 `L` 键，确认高光溢出区域显示斑马纹

   * 按 `Esc` 关闭所有面板和叠加层

   * 切换水印图/预览图/原图，确认工具数据随图片切换更新
4. **性能验证**：直方图/对比度等分析工具切换响应 < 200ms（通过降采样保证）
5. **分辨率适配**：在 1280px / 1920px / 2560px 宽度下验证布局正常
6. **更新** **`.ai/context.md`** **Changelog + 版本号 V1.3.0（MINOR：新增功能模块）+ Git 提交推送**

## Version Bump

* 当前：V1.2.4

* 目标：**V1.3.0**（MINOR — 新增审核工具集功能模块，向后兼容）

* 依据版本管理规则 §2.2：新增功能模块（审核工具集）→ MINOR +1, PATCH 归零

