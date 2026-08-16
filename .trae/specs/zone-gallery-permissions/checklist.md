* [ ] 上传接口校验 category 必填，为空时返回 400 错误

* [ ] admin 待审核照片列表对 zone\_master 角色实施分区过滤

* [ ] admin 照片详情对 zone\_master 角色实施分区权限校验（非负责分区返回 403）

* [ ] admin 审核操作（通过/拒绝）对 zone\_master 角色实施分区权限校验

* [ ] 新增分区列表接口（GET），返回 tag\_categories 数据供管理后台下拉选择

* [ ] api.md 已更新，包含新接口文档和 category 必填标注

* [ ] AdminsPage 创建表单分区字段为 select 下拉框，选项从 API 动态加载

* [ ] AdminsPage 编辑表单分区字段为 select 下拉框

* [ ] zone\_master 创建 zone\_auditor 时分区字段自动填充且禁用修改

* [ ] AdminsPage 对 zone\_master 角色开放创建 zone\_auditor 入口

* [ ] PhotosPage 收到 403 分区错误时显示提示信息

* [ ] PhotoDetailPage 收到 403 分区错误时显示"该图片不是你所负责的分区"占位提示，不展示照片内容和审核按钮

* [ ] 画廊页顶部有分区标签页导航（航空/铁路/汽车），点击切换分区

* [ ] 画廊页左侧有标签选择侧边栏，UI 与上传页标签选择组件一致

* [ ] 标签选择侧边栏根据当前分区加载对应标签对象

* [ ] 选中标签后画廊照片列表联动筛选

* [ ] 原有顶部扁平标签筛选条已移除

* [ ] 后端搜索/列表接口支持按 category 过滤

* [ ] TypeScript 类型检查通过（npx tsc --noEmit 无错误）

* [ ] 前端构建成功（npm run build 无错误）

* [ ] package.json 版本号已更新（MINOR 版本升级）

* [ ] .ai/context.md Changelog 已追加版本变更条目

* [ ] 版本管理规则.md 已更新当前版本和历史记录

* [ ] Git 已提交并推送

