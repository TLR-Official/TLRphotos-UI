/**
 * @file aircraft.ts
 * @description 航空器信息查询路由（V4.6.0）。
 *              上传页输入飞机注册号后按需查询机型/所属航司，供表单实时回显；
 *              查询本身不落 photos 表，落库发生在上传接口（见 routes/photos.ts）。
 *              鉴权 + IP 限速，避免免费上游被匿名枚举刷爆。
 */
import express from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { createRateLimiter } from '../middleware/rateLimit';
import { lookupAircraft, normalizeAircraftRegistration } from '../services/aircraftLookupService';

const router = express.Router();

// 按 IP 限速 60 次/分：单次上传通常只查 1~2 次，足够覆盖正常输入纠错
const lookupLimiter = createRateLimiter({ max: 60, message: '查询过于频繁，请稍后再试' });

/**
 * 按注册号查询航空器信息（需登录）。
 * @query reg 飞机注册号（必填，自动归一化为大写）
 * @returns { success, data: { registration, aircraft_type, icao_type, manufacturer, airline, country, source } }
 */
router.get('/lookup', lookupLimiter, requireAuth, async (req, res) => {
  try {
    const registration = normalizeAircraftRegistration(req.query.reg);
    if (!registration) {
      res.status(400).json({
        success: false,
        code: 'INVALID_REGISTRATION',
        message: '注册号格式不正确（2~20 位字母、数字或连字符）',
      });
      return;
    }

    const info = await lookupAircraft(registration);
    if (!info) {
      res.status(404).json({
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: '未收录该注册号，可继续手动填写机型与航司',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        registration: info.registration,
        aircraft_type: info.aircraftType,
        icao_type: info.icaoType,
        manufacturer: info.manufacturer,
        airline: info.airline,
        country: info.country,
        source: info.source,
      },
    });
  } catch (error) {
    console.error('Error looking up aircraft:', error);
    res.status(500).json({ success: false, message: '查询航空器信息失败，请稍后重试' });
  }
});

export default router;
