import type { Brand } from './types';
import { BRANDS } from './data';
import type { PhoneInfo } from './phone';

/** Which brand button fits this phone, or undefined when it isn't one of the supported brands. */
export function detectBrand(phone: Pick<PhoneInfo, 'brand' | 'manufacturer'>, brands: Brand[] = BRANDS): Brand | undefined {
  const keys = [phone.brand, phone.manufacturer].map((s) => s.toLowerCase().trim()).filter(Boolean);
  for (const key of keys) {
    const hit = brands.find((b) => b.match.includes(key));
    if (hit) return hit;
  }
  return undefined;
}
