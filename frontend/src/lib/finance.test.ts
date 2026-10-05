import { describe, expect, it } from 'vitest';
import { decimalToMinorUnits, localDateAtNoonUtcInput, minorUnitsToInput } from './finance';

describe('minor currency units and timezone conversion', () => {
  it('parses and formats two-decimal currency without binary floating-point arithmetic', () => {
    expect(decimalToMinorUnits('19.99', 'USD')).toBe(1999);
    expect(minorUnitsToInput(1999, 'USD')).toBe('19.99');
  });

  it('uses the currency minor-unit exponent for JPY', () => {
    expect(decimalToMinorUnits('145', 'JPY')).toBe(145);
    expect(minorUnitsToInput(145, 'JPY')).toBe('145');
    expect(() => decimalToMinorUnits('145.1', 'JPY')).toThrow(/decimal places/);
  });

  it('rejects zero, unsupported currency, malformed amounts, and excess fraction digits', () => {
    expect(() => decimalToMinorUnits('0.00', 'USD')).toThrow(/positive amount/);
    expect(() => decimalToMinorUnits('-2.50', 'USD')).toThrow(/valid positive amount/);
    expect(() => decimalToMinorUnits('1.239', 'USD')).toThrow(/decimal places/);
    expect(() => decimalToMinorUnits('1.00', 'ZZZ')).toThrow(/supported currency/);
  });

  it('converts a selected calendar date at noon in the user timezone to UTC', () => {
    expect(localDateAtNoonUtcInput('2026-10-05', 'Asia/Tokyo')).toBe('2026-10-05T03:00:00.000Z');
    expect(localDateAtNoonUtcInput('2026-10-05', 'America/Los_Angeles')).toBe('2026-10-05T19:00:00.000Z');
  });
});
