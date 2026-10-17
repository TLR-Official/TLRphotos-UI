# Checklist — V4 全模块迭代验收

## 模块一：通知中心
- [x] notifications 表落库，含 user_id+is_read 复合索引，测试库迁移通过
- [x] 点赞他人照片产生通知，取消点赞不产生；自赞不产生
- [x] 下载（代理 ?download=1）产生下载通知
- [x] 管理员确认热门产生热门通知，is_hot_confirmed=1 落库
- [x] 未读角标：unread-count 仅统计本人未读；单条已读后计数减一；全部已读清零
- [x] 一次性过审不发任何通知
- [x] 通知中心页面列表/跳转/已读交互可用，JWT 用户隔离（他人 token 取不到通知）

## 模块二：处罚与申诉
- [x] 一级处罚写入 upload_banned_until，处罚期内上传三端点均 403 UPLOAD_BANNED 且提示解禁时间；到期后自动恢复上传
- [x] 二级处罚复用 banned_at，现有会话被强制下线，重新登录被拒
- [x] 处罚必填原因，处罚产生通知，处罚历史可查，端点挂人机验证门
- [x] 用户可对本人 rejected 照片发起申诉（非 owner/非 rejected 返回错误；进行中重复申诉 409）
- [x] 用户可撤回未裁决申诉（withdrawn 后可重新发起）
- [x] 申诉通过→照片回 approved + 通过回执通知；驳回→回执含原因可跳详情
- [x] 申诉全流程后照片保持「无精修图仅预览图」状态

## 模块三：审核召回
- [x] approve/reject 写入 reviewed_by/reviewed_at；存量 approved 数据 reviewed_by=NULL 不报错
- [x] 窗口内（默认 3 分钟，RECALL_WINDOW_MINUTES 可配）召回：回 pending、不通知、清空审核人
- [x] 超窗召回：无原因 400；有原因回 pending + 按模板推送召回通知
- [x] zone_auditor 仅能召回本人审核照片（他人照片 403）；super/zone_master 可召回任意
- [x] is_hot_confirmed=1 召回返回 400 HOT_NOT_RECALLABLE
- [x] 分配/转移写入 assigned_to 与审计日志；审核员「我的已处理」列表数据正确

## 模块四：论坛
- [x] 板块收敛为航空/铁路/公路三类，seed 幂等
- [x] 专栏文章按 board_id 归入板块展示
- [x] 发帖后置审核直接发布（集成测试锁定）
- [x] forum_moderator 登录仅见论坛治理入口，删除帖子/评论可用且记审计日志；无图片审核/用户管理权限
- [x] zone_master 无法创建 forum_moderator/news_editor/super 子账号
- [x] 二级回复被回复人收到「回复 @xxx」通知，点击跳转帖子

## 模块五：新闻区
- [x] news_editor 登录仅见新闻管理入口
- [x] 创建新闻必须勾选授权确认，配图仅接受图库 photo_id（无本地上传路径）
- [x] 配图可随时更换，关联 news_images 记录授权
- [x] 前台新闻列表（首批仅航空）与详情页可用，详情展示 `@作者名 ©TLRphotos {年} 版权所有`
- [x] 配图经代理路由访问，不暴露 OSS 直链

## 模块六：关于我们
- [x] /about 页面渲染四张团队角色卡（占位文案）、站点数据卡、支持我们占位卡
- [x] 开站天数按固定开站日正确计算；已入库作品数与 /photos/stats 一致
- [x] Header/Footer 含关于我们与新闻区入口

## 工程与发布
- [x] api.md 全量同步新端点与错误码（UPLOAD_BANNED / HOT_NOT_RECALLABLE 等）
- [x] .env.example 与生产 .env 含 RECALL_WINDOW_MINUTES
- [x] 后端全套件通过（327 存量 + 新增），前端 oxlint 0 错误，vite build 成功
- [x] 版本 V4.0.0-beta 三处同步（package.json/package-lock、.ai/context.md、版本管理规则.md）
- [x] Changelog 顶部追加 + Git 提交（[release] 格式含版本号）推送
- [x] 生产部署：backend rebuild + restart tlrphotos-backend.service；冒烟通过（unread-count/recall/api/news/api/about/stats）
