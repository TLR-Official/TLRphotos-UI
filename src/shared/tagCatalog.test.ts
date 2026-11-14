import { describe, expect, it } from 'vitest';
import {
  REGISTRATION_NA,
  isRegistrationDraftValid,
  isRegistrationFilledValid,
  normalizeRegistrationInput,
} from './registration';
import {
  EMPTY_CATEGORY_FIELDS,
  TAG_CATALOG,
  buildCategoryStructuredTags,
  isCategoryFormValid,
  toDateTimeLocal,
} from './tagCatalog';

describe('registration 规则', () => {
  it('空串与 N/A 视为合法草稿', () => {
    expect(isRegistrationDraftValid('')).toBe(true);
    expect(isRegistrationDraftValid(REGISTRATION_NA)).toBe(true);
  });

  it('合法注册号通过', () => {
    expect(isRegistrationDraftValid('B-1234')).toBe(true);
    expect(isRegistrationDraftValid('N123AB')).toBe(true);
    expect(isRegistrationDraftValid('A'.repeat(20))).toBe(true);
  });

  it('非法注册号拒绝', () => {
    expect(isRegistrationDraftValid('A')).toBe(false);
    expect(isRegistrationDraftValid('-1234')).toBe(false);
    expect(isRegistrationDraftValid('AB/')).toBe(false);
    expect(isRegistrationDraftValid('b-1234')).toBe(false);
    expect(isRegistrationDraftValid('A B')).toBe(false);
    expect(isRegistrationDraftValid('A'.repeat(21))).toBe(false);
  });

  it('上传场景不允许留空', () => {
    expect(isRegistrationFilledValid('')).toBe(false);
    expect(isRegistrationFilledValid(REGISTRATION_NA)).toBe(true);
    expect(isRegistrationFilledValid('b-1234')).toBe(true);
  });

  it('输入归一化转大写并去空格', () => {
    expect(normalizeRegistrationInput('  b-1234 ')).toBe('B-1234');
  });
});

describe('tagCatalog 标签清单', () => {
  it('三大板块标签数量符合 PRD 定稿', () => {
    expect(TAG_CATALOG.aviation).toHaveLength(19);
    expect(TAG_CATALOG.railway).toHaveLength(20);
    expect(TAG_CATALOG.automobile).toHaveLength(11);
  });

  it('航空清单包含「夜拍」与「座舱 / 驾驶舱」', () => {
    expect(TAG_CATALOG.aviation).toContain('夜拍');
    expect(TAG_CATALOG.aviation).toContain('座舱 / 驾驶舱');
  });
});

describe('分区动态字段校验与组装', () => {
  const base = { ...EMPTY_CATEGORY_FIELDS, shootTime: '2026-11-14T10:30' };

  it('拍摄时间为空时三区均不通过', () => {
    expect(isCategoryFormValid('aviation', { ...base, shootTime: '', aircraftModel: 'A320', location: 'SZX' })).toBe(false);
  });

  it('航空要求机型与拍摄地点', () => {
    expect(isCategoryFormValid('aviation', base)).toBe(false);
    expect(isCategoryFormValid('aviation', { ...base, aircraftModel: 'A320', location: '深圳宝安国际机场' })).toBe(true);
  });

  it('铁路要求车号/车型/线路/局段', () => {
    expect(isCategoryFormValid('railway', { ...base, trainNumber: 'HXD1-0001' })).toBe(false);
    expect(
      isCategoryFormValid('railway', {
        ...base,
        trainNumber: 'HXD1-0001',
        trainModel: '和谐电1',
        trainLine: '京广线',
        trainBureau: '广铁集团',
      }),
    ).toBe(true);
  });

  it('汽车要求车辆编号/车型/拍摄地点', () => {
    expect(isCategoryFormValid('automobile', { ...base, vehicleNumber: 'A001' })).toBe(false);
    expect(
      isCategoryFormValid('automobile', { ...base, vehicleNumber: 'A001', vehicleModel: '比亚迪K8', location: '深圳' }),
    ).toBe(true);
  });

  it('structured_tags 按分区写入对应键', () => {
    const aviation = buildCategoryStructuredTags('aviation', {
      ...base,
      aircraftModel: 'A320',
      location: '深圳',
    });
    expect(aviation).toEqual({ 拍摄时间: '2026-11-14T10:30', 机型: 'A320' });

    const railway = buildCategoryStructuredTags('railway', {
      ...base,
      trainNumber: 'HXD1-0001',
      trainModel: '和谐电1',
      trainLine: '京广线',
      trainBureau: '广铁集团',
    });
    expect(railway).toEqual({
      拍摄时间: '2026-11-14T10:30',
      车号: 'HXD1-0001',
      车型: '和谐电1',
      拍摄线路: '京广线',
      所属局段: '广铁集团',
    });

    const automobile = buildCategoryStructuredTags('automobile', {
      ...base,
      vehicleNumber: 'A001',
      vehicleModel: '比亚迪K8',
    });
    expect(automobile).toEqual({
      拍摄时间: '2026-11-14T10:30',
      车辆编号: 'A001',
      车型: '比亚迪K8',
    });
  });

  it('toDateTimeLocal 输出 datetime-local 格式', () => {
    expect(toDateTimeLocal(new Date(2026, 10, 14, 9, 5))).toBe('2026-11-14T09:05');
  });
});
