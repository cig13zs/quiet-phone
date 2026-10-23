import type { FakeProfile } from './fake-device';
import type { PkgState } from './types';

const on = (...pkgs: string[]): Record<string, PkgState> => Object.fromEntries(pkgs.map((p) => [p, 'enabled' as PkgState]));

const GOOGLE = on(
  'android', 'com.android.systemui', 'com.android.settings', 'com.android.phone', 'com.android.shell',
  'com.android.providers.media', 'com.android.providers.contacts', 'com.android.bluetooth',
  'com.google.android.gms', 'com.google.android.gsf', 'com.android.vending', 'com.google.android.webview',
  'com.google.android.inputmethod.latin', 'com.android.chrome', 'com.google.android.youtube',
  'com.google.android.apps.messaging', 'com.google.android.dialer', 'com.google.android.apps.photos',
  'com.google.android.apps.maps', 'com.google.android.gm', 'com.android.cellbroadcastreceiver',
);

export const FAKE_PROFILES: Record<string, FakeProfile> = {
  xiaomi: {
    serial: 'DEMO-REDMI-NOTE-13',
    props: {
      'ro.product.brand': 'Redmi', 'ro.product.manufacturer': 'Xiaomi', 'ro.product.model': '23129RAA4G',
      'ro.product.marketname': 'Redmi Note 13', 'ro.build.version.release': '15', 'ro.build.version.sdk': '35',
      'ro.mi.os.version.name': 'OS2.0', 'ro.build.fingerprint': 'Redmi/demo/demo:15/AQ3A/OS2.0.1.0:user/release-keys',
    },
    packages: {
      ...GOOGLE,
      ...on(
        'com.miui.home', 'com.miui.securitycenter', 'com.xiaomi.finddevice', 'com.miui.gallery', 'com.android.camera',
        'com.miui.android.fashiongallery', 'com.miui.msa.global', 'com.miui.analytics', 'com.mi.globalminusscreen',
        'com.miui.hybrid', 'com.miui.hybrid.accessory', 'com.facebook.appmanager', 'com.facebook.services', 'com.facebook.system',
        'com.miui.daemon', 'com.xiaomi.mipicks', 'com.miui.cleaner', 'com.miui.videoplayer', 'com.miui.player',
        'com.mi.globalbrowser', 'com.xiaomi.joyose', 'com.google.android.apps.bard',
      ),
    },
    launcher: 'com.miui.home',
    keyboards: ['com.google.android.inputmethod.latin'],
    dialer: 'com.google.android.dialer',
    sms: 'com.google.android.apps.messaging',
  },
  samsung: {
    serial: 'DEMO-GALAXY-A15',
    props: {
      'ro.product.brand': 'samsung', 'ro.product.manufacturer': 'samsung', 'ro.product.model': 'SM-A155F',
      'ro.build.version.release': '14', 'ro.build.version.sdk': '34', 'ro.build.version.oneui': '60100',
      'ro.build.fingerprint': 'samsung/demo/demo:14/UP1A/A155FXXS3BXK1:user/release-keys',
    },
    packages: {
      ...GOOGLE,
      ...on(
        'com.sec.android.app.launcher', 'com.samsung.android.honeyboard', 'com.samsung.android.kgclient', 'com.samsung.android.dialer',
        'com.glance.internet', 'com.samsung.android.app.spage', 'com.aura.oobe.samsung.gl', 'com.samsung.android.ipsgeofence',
        'com.samsung.android.app.tips', 'com.facebook.appmanager', 'com.facebook.services', 'com.facebook.system',
        'com.samsung.android.rubin.app', 'com.samsung.android.game.gamehome', 'com.samsung.android.bixby.agent',
        'com.samsung.android.dynamiclock', 'com.google.android.apps.bard',
      ),
    },
    launcher: 'com.sec.android.app.launcher',
    keyboards: ['com.samsung.android.honeyboard'],
    dialer: 'com.samsung.android.dialer',
    sms: 'com.google.android.apps.messaging',
  },
  realme: {
    serial: 'DEMO-REALME-C67',
    props: {
      'ro.product.brand': 'realme', 'ro.product.manufacturer': 'realme', 'ro.product.model': 'RMX3890',
      'ro.product.marketname': 'realme C67', 'ro.build.version.release': '14', 'ro.build.version.sdk': '34',
      'ro.build.version.realmeui': 'V5.0', 'ro.build.fingerprint': 'realme/demo/demo:14/UKQ1/1700000000000:user/release-keys',
    },
    packages: {
      ...GOOGLE,
      ...on(
        'com.android.launcher', 'com.coloros.pictorial', 'com.heytap.pictorial', 'com.opos.ads', 'com.oplus.statistics.rom',
        'com.opos.cs', 'com.nearme.instant.platform', 'com.facebook.appmanager', 'com.facebook.services', 'com.facebook.system',
        'com.heytap.mcs', 'com.heytap.market', 'com.heytap.browser', 'com.heytap.themestore', 'com.oplus.games',
        'com.realme.securitycheck',
      ),
    },
    launcher: 'com.android.launcher',
    keyboards: ['com.google.android.inputmethod.latin'],
    dialer: 'com.google.android.dialer',
    sms: 'com.google.android.apps.messaging',
  },
  infinix: {
    serial: 'DEMO-INFINIX-HOT-40',
    props: {
      'ro.product.brand': 'Infinix', 'ro.product.manufacturer': 'INFINIX', 'ro.product.model': 'Infinix X6836',
      'ro.product.marketname': 'Infinix HOT 40', 'ro.build.version.release': '13', 'ro.build.version.sdk': '33',
      'ro.tranos.type': 'XOS', 'ro.tranos.version': '13.6.0', 'ro.build.fingerprint': 'Infinix/demo/demo:13/TP1A/231110V123:user/release-keys',
    },
    packages: {
      ...GOOGLE,
      ...on(
        'com.transsion.XOSLauncher', 'com.hoffnung', 'com.facemoji.lite.transsion', 'com.transsion.magazineservice.xos',
        'com.transsnet.store', 'net.bat.store', 'com.transsion.plat.appupdate', 'com.transsion.chromecustomization',
        'com.transsion.carlcare', 'com.facebook.appmanager', 'com.facebook.system', 'com.transsion.phonemaster',
        'com.talpa.hibrowser', 'com.transsion.aivoiceassistant',
      ),
    },
    launcher: 'com.transsion.XOSLauncher',
    keyboards: ['com.google.android.inputmethod.latin', 'com.facemoji.lite.transsion'],
    dialer: 'com.google.android.dialer',
    sms: 'com.google.android.apps.messaging',
  },
};

/** A deep copy, so every demo or test starts from a fresh phone. */
export function fakeProfile(id: string): FakeProfile {
  const p = FAKE_PROFILES[id];
  if (!p) throw new Error(`No demo phone called ${id}`);
  return structuredClone(p);
}
