/**
 * @file 错误边界组件
 * @description
 *  捕获子组件树中的运行时错误，避免整页白屏。
 *  核心功能：
 *   1. 通过 getDerivedStateFromError 将错误状态写入 state。
 *   2. 通过 componentDidCatch 上报错误（当前为 console）。
 *   3. 渲染错误降级 UI，提供刷新按钮。
 *  注意：错误边界无法捕获事件回调、异步代码、SSR 中的错误。
 */

import { Component, type ReactNode } from 'react';

/** ErrorBoundary Props */
interface ErrorBoundaryProps {
  children: ReactNode;
}

/** ErrorBoundary State */
interface ErrorBoundaryState {
  hasError: boolean; // 是否发生错误
  error?: Error;     // 错误对象
}

/**
 * 错误边界类组件
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /**
   * 渲染阶段捕获错误，更新 state 触发降级 UI
   * @param error - 捕获的错误
   * @returns 新的 state
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /**
   * 提交阶段捕获错误，用于日志上报
   * @param error - 捕获的错误
   */
  componentDidCatch(error: Error): void {
    console.error('ErrorBoundary caught error:', error);
  }

  render() {
    // 发生错误时渲染降级 UI
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold mb-2 text-gray-800 dark:text-white">
            页面加载失败
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6 text-center max-w-md">
            抱歉，页面出现了一些问题。请刷新页面重试，或稍后再试。
          </p>
          <button
            onClick={() => {
              // 重置错误状态并刷新页面
              this.setState({ hasError: false, error: undefined });
              window.location.reload();
            }}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            刷新页面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
