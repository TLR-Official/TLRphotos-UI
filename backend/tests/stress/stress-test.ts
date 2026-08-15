/**
 * @file 压力测试脚本
 * @description
 *  对运行中的后端服务进行压力测试，验证系统在各种负载下的稳定性。
 *  测试场景：
 *   1. 照片列表 API 并发请求（读压力）
 *   2. 图片代理 API 并发请求（IO 压力）
 *   3. 登录 API 并发请求（数据库压力）
 *   4. 持续负载下的内存监控
 *
 *  使用方式：
 *    1. 启动后端服务：cd backend && npm run dev
 *    2. 运行压力测试：npm run test:stress
 *    3. 或指定 URL：API_BASE=http://localhost:3001 npm run test:stress
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const CONCURRENCY = parseInt(process.env.STRESS_CONCURRENCY || '20', 10);
const TOTAL_REQUESTS = parseInt(process.env.STRESS_TOTAL || '200', 10);

interface TestResult {
  total: number;
  success: number;
  failed: number;
  duration: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  errors: Map<string, number>;
  memoryBefore: NodeJS.MemoryUsage;
  memoryAfter: NodeJS.MemoryUsage;
}

/**
 * 执行单个 HTTP 请求并返回延迟
 */
async function makeRequest(url: string, options?: RequestInit): Promise<{ success: boolean; latency: number; status: number }> {
  const start = performance.now();
  try {
    const response = await fetch(url, options);
    const latency = performance.now() - start;
    return { success: response.ok, latency, status: response.status };
  } catch (error) {
    const latency = performance.now() - start;
    return { success: false, latency, status: 0 };
  }
}

/**
 * 并发执行请求池
 */
async function runConcurrentPool(
  url: string,
  total: number,
  concurrency: number,
  options?: RequestInit
): Promise<Array<{ success: boolean; latency: number; status: number }>> {
  const results: Array<{ success: boolean; latency: number; status: number }> = [];
  const queue = Array(total).fill(null).map((_, i) => i);

  const workers = Array(concurrency).fill(null).map(async () => {
    while (queue.length > 0) {
      const index = queue.shift();
      if (index === undefined) break;
      const result = await makeRequest(url, options);
      results[index] = result;
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 计算百分位数
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * 分析测试结果
 */
function analyzeResults(results: Array<{ success: boolean; latency: number; status: number }>, duration: number, memoryBefore: NodeJS.MemoryUsage): TestResult {
  const latencies = results.map((r) => r.latency).sort((a, b) => a - b);
  const errors = new Map<string, number>();

  let success = 0;
  let failed = 0;

  results.forEach((r) => {
    if (r.success) {
      success++;
    } else {
      failed++;
      const key = `HTTP ${r.status}`;
      errors.set(key, (errors.get(key) || 0) + 1);
    }
  });

  const memoryAfter = process.memoryUsage();

  return {
    total: results.length,
    success,
    failed,
    duration,
    avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    minLatency: latencies[0] || 0,
    maxLatency: latencies[latencies.length - 1] || 0,
    p50Latency: percentile(latencies, 50),
    p95Latency: percentile(latencies, 95),
    p99Latency: percentile(latencies, 99),
    errors,
    memoryBefore,
    memoryAfter,
  };
}

/**
 * 打印测试报告
 */
function printReport(name: string, result: TestResult): void {
  const rps = (result.total / (result.duration / 1000)).toFixed(2);
  const memDelta = (result.memoryAfter.heapUsed - result.memoryBefore.heapUsed) / 1024 / 1024;

  console.log('\n' + '='.repeat(60));
  console.log(`  压力测试报告: ${name}`);
  console.log('='.repeat(60));
  console.log(`  总请求数:     ${result.total}`);
  console.log(`  成功:         ${result.success} (${(result.success / result.total * 100).toFixed(1)}%)`);
  console.log(`  失败:         ${result.failed} (${(result.failed / result.total * 100).toFixed(1)}%)`);
  console.log(`  并发数:       ${CONCURRENCY}`);
  console.log(`  总耗时:       ${(result.duration / 1000).toFixed(2)}s`);
  console.log(`  吞吐量:       ${rps} req/s`);
  console.log(`  ---`);
  console.log(`  平均延迟:     ${result.avgLatency.toFixed(2)}ms`);
  console.log(`  最小延迟:     ${result.minLatency.toFixed(2)}ms`);
  console.log(`  最大延迟:     ${result.maxLatency.toFixed(2)}ms`);
  console.log(`  P50 延迟:     ${result.p50Latency.toFixed(2)}ms`);
  console.log(`  P95 延迟:     ${result.p95Latency.toFixed(2)}ms`);
  console.log(`  P99 延迟:     ${result.p99Latency.toFixed(2)}ms`);
  console.log(`  ---`);
  console.log(`  内存变化:     ${memDelta > 0 ? '+' : ''}${memDelta.toFixed(2)} MB`);
  console.log(`  堆内存前:     ${(result.memoryBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  堆内存后:     ${(result.memoryAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);

  if (result.errors.size > 0) {
    console.log(`  ---`);
    console.log(`  错误分布:`);
    result.errors.forEach((count, type) => {
      console.log(`    ${type}: ${count}`);
    });
  }

  // 性能判定
  const passRate = result.success / result.total;
  const p95Acceptable = result.p95Latency < 2000; // P95 < 2s
  const memAcceptable = Math.abs(memDelta) < 50; // 内存变化 < 50MB

  console.log(`  ---`);
  console.log(`  判定: ${passRate >= 0.95 && p95Acceptable ? '✅ 通过' : '❌ 未通过'}`);
  if (passRate < 0.95) console.log(`    ⚠ 成功率 ${(passRate * 100).toFixed(1)}% 低于 95% 阈值`);
  if (!p95Acceptable) console.log(`    ⚠ P95 延迟 ${result.p95Latency.toFixed(2)}ms 超过 2000ms 阈值`);
  if (!memAcceptable) console.log(`    ⚠ 内存变化 ${memDelta.toFixed(2)}MB 超过 50MB 阈值`);
  console.log('='.repeat(60) + '\n');
}

/**
 * 等待服务可用
 */
async function waitForService(url: string, maxRetries = 10): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return true;
    } catch {
      // 服务未启动
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * 主函数
 */
async function main() {
  console.log(`\n🚀 压力测试启动`);
  console.log(`   目标: ${API_BASE}`);
  console.log(`   并发: ${CONCURRENCY}`);
  console.log(`   总请求数: ${TOTAL_REQUESTS}`);

  // 等待服务可用
  const healthy = await waitForService(`${API_BASE}/api/photos`);
  if (!healthy) {
    console.error(`\n❌ 无法连接到 ${API_BASE}，请确保后端服务已启动`);
    process.exit(1);
  }
  console.log(`   服务状态: ✅ 可用\n`);

  // 测试 1: 照片列表 API（读压力）
  console.log('📋 测试 1: 照片列表 API 并发读取...');
  const memBefore1 = process.memoryUsage();
  const start1 = performance.now();
  const results1 = await runConcurrentPool(
    `${API_BASE}/api/photos?page=1&limit=20`,
    TOTAL_REQUESTS,
    CONCURRENCY
  );
  const duration1 = performance.now() - start1;
  printReport('照片列表 API', analyzeResults(results1, duration1, memBefore1));

  // 测试 2: 标签列表 API
  console.log('📋 测试 2: 标签列表 API 并发读取...');
  const memBefore2 = process.memoryUsage();
  const start2 = performance.now();
  const results2 = await runConcurrentPool(
    `${API_BASE}/api/photos/tags`,
    Math.min(TOTAL_REQUESTS, 100),
    Math.min(CONCURRENCY, 10)
  );
  const duration2 = performance.now() - start2;
  printReport('标签列表 API', analyzeResults(results2, duration2, memBefore2));

  // 测试 3: 登录 API（数据库写入压力）
  console.log('📋 测试 3: 登录 API 并发请求...');
  const memBefore3 = process.memoryUsage();
  const start3 = performance.now();
  const loginPayload = JSON.stringify({
    email: 'stress-test@example.com',
    password: 'WrongPassword',
  });
  const results3 = await runConcurrentPool(
    `${API_BASE}/api/auth/login`,
    Math.min(TOTAL_REQUESTS, 100),
    Math.min(CONCURRENCY, 10),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: loginPayload,
    }
  );
  const duration3 = performance.now() - start3;
  printReport('登录 API', analyzeResults(results3, duration3, memBefore3));

  // 测试 4: 图片代理 API（IO 压力）
  console.log('📋 测试 4: 图片代理 API 并发请求...');
  const memBefore4 = process.memoryUsage();
  const start4 = performance.now();
  const results4 = await runConcurrentPool(
    `${API_BASE}/api/photos/image/nonexistent-stress-test.jpg`,
    Math.min(TOTAL_REQUESTS, 50),
    Math.min(CONCURRENCY, 10)
  );
  const duration4 = performance.now() - start4;
  printReport('图片代理 API', analyzeResults(results4, duration4, memBefore4));

  // 最终内存检查
  const finalMem = process.memoryUsage();
  console.log('\n' + '='.repeat(60));
  console.log('  最终内存状态');
  console.log('='.repeat(60));
  console.log(`  RSS:          ${(finalMem.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  堆已用:       ${(finalMem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  堆总量:       ${(finalMem.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  外部内存:     ${(finalMem.external / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  数组缓冲区:   ${(finalMem.arrayBuffers / 1024 / 1024).toFixed(2)} MB`);
  console.log('='.repeat(60) + '\n');

  console.log('✅ 压力测试完成\n');
}

main().catch((error) => {
  console.error('压力测试失败:', error);
  process.exit(1);
});
