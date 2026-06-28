# TLRphotos - 航空摄影工作室

航空摄影作品展示与管理的极简网站。

## 技术栈

- **前端**：React + TypeScript + Vite + TailwindCSS
- **后端**：PocketBase（规划中）
- **存储**：混合模式 - 本地缩略图 + Cloudflare R2 原图

## 项目结构

```
TLRphotos/
├── .ai/                    # 项目上下文文档
│   └── context.md
├── src/
│   ├── features/           # 业务功能模块
│   │   └── gallery/        # 画廊相关组件
│   ├── shared/             # 共享组件与工具
│   ├── App.tsx             # 应用入口
│   └── main.tsx            # React 挂载点
├── public/                 # 静态资源
│   └── favicon.svg         # 网站图标
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 规范

- 所有 UI 开发在本地完成
- 服务器仅运行 PocketBase 和存储数据
- 列表页 API 必须按需查询指定字段

## License

MIT
