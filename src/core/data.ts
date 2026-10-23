import type { Brand, Essentials, PackageList, SettingsTip } from './types';
import brandsJson from '../../data/brands.json';
import essentialJson from '../../data/essential.json';
import common from '../../data/lists/common.json';
import xiaomi from '../../data/lists/xiaomi.json';
import samsung from '../../data/lists/samsung.json';
import coloros from '../../data/lists/coloros.json';
import realme from '../../data/lists/realme.json';
import vivo from '../../data/lists/vivo.json';
import transsion from '../../data/lists/transsion.json';
import motorola from '../../data/lists/motorola.json';
import huawei from '../../data/lists/huawei.json';
import honor from '../../data/lists/honor.json';

export const LISTS: Record<string, PackageList> = Object.fromEntries(
  [common, xiaomi, samsung, coloros, realme, vivo, transsion, motorola, huawei, honor].map((l) => [l.id, l as PackageList]),
);

export const BRANDS: Brand[] = brandsJson.brands as Brand[];
export const EVERY_PHONE: SettingsTip[] = brandsJson.everyPhone;
export const ESSENTIALS: Essentials = essentialJson as Essentials;

export function brandById(id: string): Brand | undefined {
  return BRANDS.find((b) => b.id === id);
}

export function listsFor(brand: Brand): PackageList[] {
  return brand.lists.map((id) => {
    const list = LISTS[id];
    if (!list) throw new Error(`Brand ${brand.id} names a list that does not exist: ${id}`);
    return list;
  });
}
