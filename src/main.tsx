/**
 * @file React 渲染入口
 * @description
 *  应用挂载入口，负责将根组件渲染到 DOM。
 *  核心功能：
 *   1. 使用 createRoot 将 App 挂载到 #root 节点。
 *   2. 包裹 StrictMode 以便在开发阶段检测潜在副作用问题。
 *   3. 包裹 ErrorBoundary 捕获根级渲染错误，避免白屏。
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './shared/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
