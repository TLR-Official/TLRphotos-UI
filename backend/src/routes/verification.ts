/**
 * @file verification.ts
 * @description 人机验证路由模块（V1.8.0）。
 *              前台用户侧的 Turnstile 人机验证端点：
 *              - POST /verify：提交 Turnstile 挑战令牌，校验通过后建立 168h 验证状态
 *              - GET /status：查询当前用户验证状态（是否已验证、到期时间）
 *              高危操作被 403 (code=HUMAN_VERIFICATION_REQUIRED) 拦截后，
 *              前端弹出验证组件 → 完成挑战 → 调用 /verify → 重试原操作。
 */
import express from 'express';
import { loadAuthUser } from '../services/authService';
import {
  verifyTurnstileToken,
  saveVerification,
  getValidVerification,
  getVerificationIp,
  isTestBypass,
  VERIFICATION_ACTIONS,
  type VerificationAction,
} from '../services/verificationService';

const router = express.Router();

/**
 * 提交人机验证结果。
 * 服务端 canonical siteverify 校验（success + action + hostname，fail-closed），
 * 通过后为当前用户建立/刷新 168 小时验证状态（绑定当前 IP）。
 * @body turnstile_token 前端 Turnstile widget 返回的令牌
 * @body action 与 widget data-action 一致的操作类型（白名单内）
 * @body tokens 测试环境专用绕过参数（NODE_ENV=test 且匹配 TEST_BYPASS_TOKEN）
 */
router.post('/verify', async (req, res) => {
  try {
    const { user: authUser, error: authErr } = await loadAuthUser(req);
    if (authErr || !authUser) {
      return res.status(authErr?.status || 401).json({
        success: false,
        message: authErr?.message || '请先登录',
        code: authErr?.code || 'AUTH_REQUIRED',
      });
    }

    const { turnstile_token, tokens } = req.body;
    const action = req.body.action as VerificationAction;

    if (!VERIFICATION_ACTIONS.includes(action)) {
      return res.status(400).json({ success: false, message: '无效的验证操作类型' });
    }

    const ip = getVerificationIp(req);

    if (!isTestBypass(tokens)) {
      const verdict = await verifyTurnstileToken(turnstile_token, action, ip);
      if (!verdict.ok) {
        return res.status(verdict.status).json({ success: false, code: 'HUMAN_VERIFICATION_FAILED', message: verdict.message });
      }
    }

    await saveVerification('user', authUser.id, ip, action);
    const state = await getValidVerification('user', authUser.id, ip);

    res.json({ success: true, data: { verified: true, verified_at: state?.verifiedAt, expires_at: state?.expiresAt } });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ success: false, message: '人机验证失败，请重试' });
  }
});

/**
 * 查询当前用户的人机验证状态。
 * 返回 verified / verified_at / expires_at，前端据此决定是否弹出验证组件。
 */
router.get('/status', async (req, res) => {
  try {
    const { user: authUser, error: authErr } = await loadAuthUser(req);
    if (authErr || !authUser) {
      return res.status(authErr?.status || 401).json({
        success: false,
        message: authErr?.message || '请先登录',
        code: authErr?.code || 'AUTH_REQUIRED',
      });
    }

    const state = await getValidVerification('user', authUser.id, getVerificationIp(req));
    res.json({ success: true, data: { verified: !!state, verified_at: state?.verifiedAt, expires_at: state?.expiresAt } });
  } catch (error) {
    console.error('Verification status error:', error);
    res.status(500).json({ success: false, message: '查询验证状态失败' });
  }
});

export default router;
