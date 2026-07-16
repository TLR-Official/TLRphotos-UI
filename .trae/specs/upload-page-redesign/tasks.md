# TLR Photos - 上传页面大改版实施计划

## [x] Task 1: 创建标签数据库和后端API
## [x] Task 2: 修改后端上传接口支持分类和结构化标签
## [x] Task 3: 重构上传页面布局 - 添加分类选择
## [x] Task 4: 重构上传页面 - 取消强制描述和自定义标签
## [x] Task 5: 实现差异化上传模板
## [x] Task 6: 添加安全合规声明
## [/] Task 7: 编译部署和测试
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 创建独立的标签数据库 `/opt/tlr-photos-ui/data/tags.db`
  - 设计标签表结构（一级分类、二级对象、三级属性）
  - 实现标签查询API
  - 初始化标签数据（根据用户提供的标签体系文档）
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - `programmatic` TR-1.1: GET /api/tags 返回所有一级分类
  - `programmatic` TR-1.2: GET /api/tags/aviation 返回航空类二级对象和三级属性
- **Notes**: 标签数据需要存储独立于主数据库，确保代码同步时不丢失

## [ ] Task 2: 修改后端上传接口支持分类和结构化标签
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 在photos表中添加category字段
  - 修改上传接口接收category和structured_tags参数
  - 添加关键词黑名单过滤逻辑
  - 支持三级属性标签的存储（键值对格式）
- **Acceptance Criteria Addressed**: AC-4, AC-8
- **Test Requirements**:
  - `programmatic` TR-2.1: 上传照片时正确保存category字段
  - `programmatic` TR-2.2: 包含敏感词汇的标签被正确过滤
- **Notes**: 需要处理旧照片的category默认值

## [ ] Task 3: 重构上传页面布局 - 添加分类选择
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 在上传页面顶部添加航空类、铁路类、汽车类三个分类标签
  - 实现分类切换逻辑
  - 添加分类选择的必填验证
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `human-judgment` TR-3.1: 分类标签显示清晰，切换流畅
  - `programmatic` TR-3.2: 未选择分类时无法提交
- **Notes**: 需要设计美观的分类标签样式

## [ ] Task 4: 重构上传页面 - 取消强制描述和自定义标签
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 将描述字段改为可选（去掉红色星号和必填验证）
  - 移除自定义标签输入框
  - 添加预设标签选择组件
  - 实现标签选择/取消逻辑
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `programmatic` TR-4.1: 仅填写标题即可提交
  - `human-judgment` TR-4.2: 标签选择组件交互流畅
- **Notes**: 标签选择组件需要支持多选和搜索

## [ ] Task 5: 实现差异化上传模板
- **Priority**: high
- **Depends On**: Task 3
- **Description**: 
  - 根据分类显示不同的专属字段
  - 航空类：机型、机场、地勤车辆等
  - 铁路类：列车类型、车站、线路设施等
  - 汽车类：车辆类型、品牌型号等
  - 通用字段保持不变（图片信息、拍摄参数）
- **Acceptance Criteria Addressed**: AC-4, AC-5
- **Test Requirements**:
  - `human-judgment` TR-5.1: 选择不同分类时表单字段正确切换
  - `human-judgment` TR-5.2: 专属字段设计合理，符合类别需求
- **Notes**: 需要根据用户提供的标签体系文档设计专属字段

## [ ] Task 6: 添加安全合规声明
- **Priority**: medium
- **Depends On**: None
- **Description**: 
  - 在表单末尾添加安全合规声明勾选框
  - 添加强制勾选验证
  - 声明内容："我确认本影像不涉及任何军事设施、装备或敏感区域"
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `programmatic` TR-6.1: 未勾选声明时提交按钮禁用
  - `human-judgment` TR-6.2: 声明内容清晰可见
- **Notes**: 声明内容需要严格按照用户提供的文档

## [ ] Task 7: 编译部署和测试
- **Priority**: medium
- **Depends On**: Tasks 1-6
- **Description**: 
  - 编译前端和后端代码
  - 部署到服务器
  - 测试所有功能是否正常工作
- **Acceptance Criteria Addressed**: 所有AC
- **Test Requirements**:
  - `human-judgment` TR-7.1: 完整测试上传流程
  - `human-judgment` TR-7.2: 验证不同分类的差异化模板
- **Notes**: 需要测试各种边界情况