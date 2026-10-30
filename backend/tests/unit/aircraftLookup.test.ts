/**
 * @file 航空器查询纯函数单元测试（V4.6.0）
 * @description 覆盖注册号归一化与机型展示标签拼接，确保上传落库字段格式稳定。
 *              不触网、不依赖数据库（lookupAircraft 的缓存/上游逻辑由集成冒烟覆盖）。
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeAircraftRegistration,
  buildAircraftTypeLabel,
} from '../../src/services/aircraftLookupService';

describe('normalizeAircraftRegistration 注册号归一化', () => {
  it('去空格并转为大写', () => {
    expect(normalizeAircraftRegistration(' b-2088 ')).toBe('B-2088');
    expect(normalizeAircraftRegistration('n123ab')).toBe('N123AB');
  });

  it('保留连字符', () => {
    expect(normalizeAircraftRegistration('9h-abc')).toBe('9H-ABC');
  });

  it('非法输入返回空串', () => {
    expect(normalizeAircraftRegistration('')).toBe('');
    expect(normalizeAircraftRegistration('B')).toBe('');
    expect(normalizeAircraftRegistration('B 2088')).toBe('B2088'); // 空格被剔除后合法
    expect(normalizeAircraftRegistration('B-2088#')).toBe('');
    expect(normalizeAircraftRegistration(null)).toBe('');
    expect(normalizeAircraftRegistration(123)).toBe('');
  });

  it('超过 20 位返回空串', () => {
    expect(normalizeAircraftRegistration('A'.repeat(21))).toBe('');
    expect(normalizeAircraftRegistration('A'.repeat(20))).toBe('A'.repeat(20));
  });
});

describe('buildAircraftTypeLabel 机型展示标签', () => {
  it('ICAO 代码命中字典时使用友好型号名', () => {
    expect(buildAircraftTypeLabel('Boeing', 'B77W', 'B777-300ER')).toBe('Boeing 777-300ER');
  });

  it('ICAO 代码未收录时回退上游原始型号', () => {
    expect(buildAircraftTypeLabel('Airbus', 'A19N', 'A319neo')).toBe('Airbus A319neo');
  });

  it('无原始型号时回退 ICAO 代码', () => {
    expect(buildAircraftTypeLabel('Boeing', 'B738', '')).toBe('Boeing 737-800');
    expect(buildAircraftTypeLabel('', 'ZZZZ', '')).toBe('ZZZZ');
  });

  it('manufacturer 缺失时不拼接前缀', () => {
    expect(buildAircraftTypeLabel(null, 'A320', 'A320')).toBe('A320');
  });

  it('全部缺失时返回空串', () => {
    expect(buildAircraftTypeLabel('', '', '')).toBe('');
    expect(buildAircraftTypeLabel(undefined, undefined, undefined)).toBe('');
  });
});
