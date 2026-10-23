#!/usr/bin/env node
// A stand-in for the adb binary, for tests. Keeps one pretend phone's packages in the JSON file
// named by FAKE_ADB_STATE and answers like adb + Android's pm would.
import fs from 'node:fs';

const statePath = process.env.FAKE_ADB_STATE;
const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const save = () => fs.writeFileSync(statePath, JSON.stringify(st));
const out = (s) => process.stdout.write(s);
let args = process.argv.slice(2);

if (args[0] === 'devices') {
  out('List of devices attached\n');
  if (st.serial) out(`${st.serial}       ${st.authorized === false ? 'unauthorized' : 'device'} usb:1-1 product:demo model:${st.model} device:demo transport_id:1\n`);
  process.exit(0);
}
if (args[0] === '-s') {
  if (args[1] !== st.serial) { process.stderr.write(`adb: device '${args[1]}' not found\n`); process.exit(1); }
  args = args.slice(2);
}
const [cmd, ...rest] = args;
if (cmd === 'push') {
  st.files[rest[1]] = fs.readFileSync(rest[0], 'utf8');
  save();
  out(`${rest[0]}: 1 file pushed.\n`);
  process.exit(0);
}
if (cmd !== 'shell') { process.stderr.write('unsupported\n'); process.exit(1); }
const [c, ...r] = rest;
const last = r[r.length - 1];
const pk = st.packages;
if (c === 'getprop') { out(Object.entries(st.props).map(([k, v]) => `[${k}]: [${v}]`).join('\n') + '\n'); process.exit(0); }
if (c === 'cat') { if (st.files[last] == null) { process.stderr.write(`cat: ${last}: No such file or directory\n`); process.exit(1); } out(st.files[last]); process.exit(0); }
if (c === 'pm' && r[0] === 'list') {
  const filter = r.slice(2).find((f) => !f.startsWith('-') && f !== '0');
  for (const [p, s] of Object.entries(pk)) {
    if (filter && !p.includes(filter)) continue;
    if (s === 'removed' && !r.includes('-u')) continue;
    if (r.includes('-d') && s !== 'disabled') continue;
    out(`package:${p}\n`);
  }
  process.exit(0);
}
if (c === 'pm' && r[0] === 'disable-user') {
  if (st.blockDisable?.includes(last)) { process.stderr.write(`java.lang.SecurityException: Shell cannot change component state for ${last} to 3\n`); process.exit(255); }
  pk[last] = 'disabled'; save(); out(`Package ${last} new state: disabled-user\n`); process.exit(0);
}
if (c === 'pm' && r[0] === 'enable') { pk[last] = 'enabled'; save(); out(`Package ${last} new state: enabled\n`); process.exit(0); }
if (c === 'pm' && r[0] === 'uninstall') { pk[last] = 'removed'; save(); out('Success\n'); process.exit(0); }
if ((c === 'cmd' && r[1] === 'install-existing') || (c === 'pm' && r[0] === 'install-existing')) { if (pk[last] === 'removed') pk[last] = 'enabled'; save(); out(`Package ${last} installed for user: 0\n`); process.exit(0); }
if (c === 'cmd' && r[1] === 'resolve-activity') { out(`priority=0\n${st.launcher}/.Launcher\n`); process.exit(0); }
if (c === 'settings') { out(`${st.keyboard}/.Ime\n`); process.exit(0); }
if (c === 'cmd' && r[0] === 'role') { out('\n'); process.exit(0); }
process.stderr.write(`/system/bin/sh: ${c}: not found\n`);
process.exit(127);
