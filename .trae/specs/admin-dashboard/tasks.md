# 管理后台系统 - Implementation Plan

## [ ] Task 1: 后端数据库结构扩展
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 在数据库中添加admin_users表（管理员账户）
  - 在photos表中添加status字段（审核状态）
  - 创建admin_logs表（操作日志）
- **Acceptance Criteria Addressed**: [AC-1, AC-2, AC-3, AC-6]
- **Test Requirements**:
  - `programmatic` TR-1.1: 数据库表创建成功，字段正确
  - `programmatic` TR-1.2: photos表成功添加status字段
- **Notes**: 最高账户需要手动插入数据库

## [ ] Task 2: 后端管理员认证API
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 实现管理员登录API（POST /api/admin/login）
  - 实现管理员JWT认证中间件
  - 实现权限验证中间件
- **Acceptance Criteria Addressed**: [AC-1, AC-2]
- **Test Requirements**:
  - `programmatic` TR-2.1: 正确凭证返回JWT token
  - `programmatic` TR-2.2: 错误凭证返回401
  - `programmatic` TR-2.3: 无token访问需要认证的API返回401
- **Notes**: 使用独立的JWT密钥与前端用户认证区分

## [ ] Task 3: 后端管理员账户管理API
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 实现创建管理员账户API（最高账户创建分区总审核）
  - 实现管理员列表API
  - 实现编辑管理员API
  - 实现禁用/启用管理员API
- **Acceptance Criteria Addressed**: [AC-4]
- **Test Requirements**:
  - `programmatic` TR-3.1: 最高账户可创建分区总审核账户
  - `programmatic` TR-3.2: 分区总审核可创建分区审核账户
  - `programmatic` TR-3.3: 分区审核无法创建任何账户
- **Notes**: 权限继承规则：最高 > 分区总审核 > 分区审核

## [ ] Task 4: 后端照片审核API
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 实现待审核照片列表API
  - 实现审核通过API
  - 实现审核拒绝API
  - 实现审核记录API
- **Acceptance Criteria Addressed**: [AC-3]
- **Test Requirements**:
  - `programmatic` TR-4.1: 待审核列表只返回status=pending的照片
  - `programmatic` TR-4.2: 审核通过后照片status变为approved
  - `programmatic` TR-4.3: 审核拒绝后照片status变为rejected
- **Notes**: 审核操作需记录到操作日志

## [ ] Task 5: 后端用户管理与日志API
- **Priority**: medium
- **Depends On**: Task 2
- **Description**: 
  - 实现用户列表API
  - 实现禁用/解禁用户API
  - 实现操作日志API（查询、记录）
  - 实现数据统计API
- **Acceptance Criteria Addressed**: [AC-5, AC-6, AC-7]
- **Test Requirements**:
  - `programmatic` TR-5.1: 用户禁用后无法登录
  - `programmatic` TR-5.2: 所有操作都记录到日志表
  - `programmatic` TR-5.3: 统计API返回正确的数据
- **Notes**: 操作日志需要自动记录，无需手动调用

## [ ] Task 6: 前端管理后台登录页面
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 创建管理后台登录页面
  - 实现登录表单和认证逻辑
  - 实现登录状态管理
- **Acceptance Criteria Addressed**: [AC-1]
- **Test Requirements**:
  - `human-judgment` TR-6.1: 登录页面设计简洁清晰
  - `programmatic` TR-6.2: 登录成功后跳转到首页
- **Notes**: 管理后台前端独立于主站前端

## [ ] Task 7: 前端管理后台布局与导航
- **Priority**: high
- **Depends On**: Task 6
- **Description**: 
  - 创建管理后台主布局（侧边栏、顶部导航）
  - 实现权限控制的导航菜单
  - 实现公共组件（面包屑、表格、分页）
- **Acceptance Criteria Addressed**: [AC-2]
- **Test Requirements**:
  - `human-judgment` TR-7.1: 布局合理，导航清晰
  - `programmatic` TR-7.2: 不同权限用户看到不同菜单
- **Notes**: 使用Tailwind CSS实现简洁实用的设计

## [ ] Task 8: 前端照片审核模块
- **Priority**: high
- **Depends On**: Task 4, Task 7
- **Description**: 
  - 创建待审核照片列表页面
  - 创建照片详情审核弹窗
  - 实现审核通过/拒绝操作
- **Acceptance Criteria Addressed**: [AC-3]
- **Test Requirements**:
  - `human-judgment` TR-8.1: 审核流程清晰直观
  - `programmatic` TR-8.2: 审核操作正确调用API
- **Notes**: 需要支持批量审核

## [ ] Task 9: 前端管理员账户管理模块
- **Priority**: high
- **Depends On**: Task 3, Task 7
- **Description**: 
  - 创建管理员列表页面
  - 创建创建/编辑管理员弹窗
  - 实现禁用/启用操作
- **Acceptance Criteria Addressed**: [AC-4]
- **Test Requirements**:
  - `human-judgment` TR-9.1: 账户管理操作流程清晰
  - `programmatic` TR-9.2: 权限控制正确（低级账户无法创建高级账户）
- **Notes**: 创建账户时需要设置初始密码

## [ ] Task 10: 前端用户管理、日志与统计模块
- **Priority**: medium
- **Depends On**: Task 5, Task 7
- **Description**: 
  - 创建用户列表页面（查看、禁用）
  - 创建操作日志页面
  - 创建数据统计页面
  - 创建系统设置页面
- **Acceptance Criteria Addressed**: [AC-5, AC-6, AC-7]
- **Test Requirements**:
  - `human-judgment` TR-10.1: 页面布局合理，信息展示直观
  - `programmatic` TR-10.2: API调用正确，数据展示准确
- **Notes**: 统计页面可使用简单的图表展示

## [ ] Task 11: Nginx配置与部署
- **Priority**: high
- **Depends On**: All Tasks
- **Description**: 
  - 配置admin.tlrphotos.com子域名
  - 配置Nginx反向代理
  - 部署前端和后端代码
- **Acceptance Criteria Addressed**: [AC-1]
- **Test Requirements**:
  - `programmatic` TR-11.1: 访问admin.tlrphotos.com可打开管理后台
  - `programmatic` TR-11.2: 登录功能正常工作
- **Notes**: 需要SSL证书配置