# 项目上下文

## Changelog
| 2026-08-05 09:50 | [refactor] 重构照片审核流程为详情页审核模式 | src/admin/{PhotosPage,PhotoDetailPage,AdminApp}.tsx, src/admin/{api,types}.ts, backend/src/routes/admin.ts |
| 2026-08-05 10:05 | [fix] 修复管理后台路由系统：改用URL路径解析照片ID和侧边栏导航 | src/admin/{AdminApp,Layout}.tsx |
| 2026-08-05 10:15 | [fix] PhotoDetailPage改用props接收照片ID，彻底移除useParams | src/admin/PhotoDetailPage.tsx, src/admin/AdminApp.tsx |

| 2026-08-04 22:30 | [feat] 实现未审核照片访问控制与驳回理由展示 | backend/src/{routes/photos.ts,routes/admin.ts,routes/auth.ts,utils/url.ts,db.ts}, src/{api/auth.ts,features/profile/ProfilePage.tsx} |
| 2026-08-04 11:58 | [docs] 为 admin 后台 6 个文件添加中文注释 | src/admin/{DashboardPage,PhotosPage,AdminsPage,UsersPage,LogsPage,api}.tsx/ts |
| 2026-08-04 11:30 | [docs] 为前端 25 个页面/组件添加中文注释 | src/features/**, src/shared/**, src/admin/** |
