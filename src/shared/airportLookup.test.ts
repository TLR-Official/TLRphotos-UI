import { describe, expect, it } from 'vitest';
import {
  formatAirportLocation,
  isAirportCode,
  lookupAirport,
  normalizeAirportCode,
} from './airportLookup';

describe('机场识别', () => {
  it('IATA 与 ICAO 均可命中同一机场', async () => {
    const byIata = await lookupAirport('SZX');
    const byIcao = await lookupAirport('ZGSZ');
    expect(byIata?.name).toBe('深圳宝安国际机场');
    expect(byIcao?.name).toBe('深圳宝安国际机场');
    expect(byIata?.iata).toBe('SZX');
    expect(byIata?.icao).toBe('ZGSZ');
    expect(byIata?.country).toBe('CN');
  });

  it('代码大小写与首尾空白不敏感', async () => {
    const match = await lookupAirport('  szx ');
    expect(match?.iata).toBe('SZX');
  });

  it('非完整代码不命中', async () => {
    expect(await lookupAirport('')).toBeNull();
    expect(await lookupAirport('SZ')).toBeNull();
    expect(await lookupAirport('SZXA1')).toBeNull();
    expect(await lookupAirport('N/A')).toBeNull();
    expect(await lookupAirport('深圳宝安国际机场')).toBeNull();
  });

  it('未收录的完整代码返回 null', async () => {
    expect(await lookupAirport('QQQ')).toBeNull();
    expect(await lookupAirport('ZZZZ')).toBeNull();
  });

  it('isAirportCode 仅接受 3 位 IATA 或 4 位 ICAO', () => {
    expect(isAirportCode('SZX')).toBe(true);
    expect(isAirportCode('zgsz')).toBe(true);
    expect(isAirportCode('SZ')).toBe(false);
    expect(isAirportCode('SZXZZ')).toBe(false);
    expect(isAirportCode('N/A')).toBe(false);
  });

  it('normalizeAirportCode 统一大写并去空白', () => {
    expect(normalizeAirportCode(' pek ')).toBe('PEK');
  });

  it('回填文案包含名称与代码', () => {
    expect(
      formatAirportLocation({
        iata: 'SZX',
        icao: 'ZGSZ',
        name: '深圳宝安国际机场',
        city: 'Shenzhen',
        country: 'CN',
      }),
    ).toBe('深圳宝安国际机场（SZX）');
  });
});
