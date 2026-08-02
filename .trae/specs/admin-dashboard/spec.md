# 管理后台系统 - Product Requirement Document

## Overview
- **Summary**: 开发一个功能完整的管理后台系统，部署在admin.tlrphotos.com子域名下，包含三级权限体系和完整的管理功能模块
- **Purpose**: 实现照片审核、用户管理、系统配置等管理功能，确保平台内容安全和运营效率
- **Target Users**: 系统管理员、分区总审核员、分区审核员

## Goals
- 建立三级权限体系（最高账户、分区总审核账户、分区审核账户）
- 实现照片审核工作流（待审核、通过、拒绝）
- 实现管理员账户管理（创建、编辑、禁用）
- 实现用户信息管理（查看、禁用）
- 实现操作日志记录与查询
- 实现数据统计展示

## Non-Goals (Out of Scope)
- 不提供最高账户的界面注册功能（仅服务器端数据库操作）
- 不包含前端用户界面的管理功能
- 不涉及移动端适配

## Background & Context
- 现有系统已包含用户认证、照片上传、标签管理等功能
- 需要独立的管理后台进行内容审核和系统管理
- 管理后台部署在独立子域名admin.tlrphotos.com

## Functional Requirements
- **FR-1**: 管理员登录认证模块
- **FR-2**: 三级权限控制模块（最高账户、分区总审核、分区审核）
- **FR-3**: 管理员账户管理模块（创建、编辑、禁用）
- **FR-4**: 照片审核工作流模块（待审核列表、审核通过、拒绝）
- **FR-5**: 用户信息管理模块（查看、禁用、解禁）
- **FR-6**: 操作日志模块（记录所有管理操作）
- **FR-7**: 数据统计模块（用户数、照片数、审核统计）
- **FR-8**: 系统设置模块

## Non-Functional Requirements
- **NFR-1**: 管理后台必须通过认证后才能访问
- **NFR-2**: 严格的权限隔离，低级别账户无法访问高级功能
- **NFR-3**: 操作日志必须完整记录，不可篡改
- **NFR-4**: 界面设计简洁实用，操作流程清晰

## Constraints
- **Technical**: Node.js + Express + SQLite, React + Tailwind CSS
- **Deployment**: 子域名admin.tlrphotos.com，通过Nginx反向代理
- **Dependencies**: 依赖现有后端数据库结构

## Assumptions
- 最高账户通过服务器端SQLite命令行创建
- 管理后台与前端共用同一个后端API
- 照片审核状态字段需在现有photos表中添加

## Acceptance Criteria

### AC-1: 管理员登录
- **Given**: 管理员访问admin.tlrphotos.com
- **When**: 输入正确的用户名和密码
- **Then**: 成功登录并进入管理后台首页
- **Verification**: `programmatic`

### AC-2: 权限控制
- **Given**: 分区审核员登录
- **When**: 尝试访问分区总审核员的功能
- **Then**: 系统拒绝访问并提示权限不足
- **Verification**: `programmatic`

### AC-3: 照片审核
- **Given**: 存在待审核的照片
- **When**: 审核员点击通过或拒绝
- **Then**: 照片状态更新，操作记录到日志
- **Verification**: `programmatic`

### AC-4: 管理员账户管理
- **Given**: 最高账户登录
- **When**: 创建分区总审核账户
- **Then**: 新账户创建成功，可登录系统
- **Verification**: `programmatic`

### AC-5: 用户管理
- **Given**: 管理员登录
- **When**: 禁用某个用户
- **Then**: 用户无法登录，其上传的照片仍保留
- **Verification**: `programmatic`

### AC-6: 操作日志
- **Given**: 管理员执行任意操作
- **When**: 查看操作日志
- **Then**: 可以看到完整的操作记录（时间、操作人、操作类型、详情）
- **Verification**: `human-judgment`

### AC-7: 数据统计
- **Given**: 管理员登录
- **When**: 查看统计页面
- **Then**: 显示用户总数、照片总数、待审核数等统计数据
- **Verification**: `human-judgment`

## Open Questions
- [ ] 分区审核账户的分区如何定义？按地理区域还是按内容分类？
- [ ] 审核拒绝的照片是否需要保存记录？
- [ ] 是否需要邮件通知审核结果？