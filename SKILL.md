---
name: quiet-phone
description: Turn off lock-screen ads (Glance and similar), phone-maker ad services and preinstalled junk on an Android phone connected over USB, reversibly, with the quiet-phone CLI and local adb. Use when someone asks to remove ads, bloatware or Glance from their Android phone, or to undo that. Always shows the list and gets the owner's yes before changing anything.
---

# Quiet Phone

Quiet Phone turns apps off with `pm disable-user --user 0`, records every change, and can put
everything back. It only touches packages on its published lists, and it refuses system parts,
Google Play services, keyboards, the launcher and the default phone and SMS apps.

You need `adb` on PATH (Android platform tools) and Node 20 or later. The phone needs USB
debugging on and must have allowed this computer.

## The rule

List, ask, then act. Never pass `--yes` to `apply` or `restore` until the phone's owner has seen
the list and said yes in this conversation. If they only asked a question, run `scan` and stop.

## Steps

1. Check the phone is there:

   ```bash
   adb devices
   ```

   `unauthorized` means the owner must unlock the phone and tap **Allow** on "Allow USB
   debugging?". No device at all: USB debugging is off, the cable is charge-only, or the USB mode
   needs to be File transfer. With more than one phone, add `--serial <serial>` to every command.

2. See what is on it:

   ```bash
   npx -y quiet-phone scan --json
   ```

   Read `phone`, `brand`, `candidates` and `plan`. `plan` is the one-button choice: the packages
   marked `safe` that are still on. `restorable` lists earlier changes; `cameBack` lists ones an
   update switched back on. If `brand` is null, the brand isn't supported; say so, and offer
   `--brand <id>` (see `npx quiet-phone brands`) only if the owner knows a close match.

3. Show the owner a short table: label, risk, and the one-line reason, for the packages in
   `plan`. Mention the `caution` ones separately and say what each one would cost them (the
   reason says it). Do not suggest `expert` items unless they ask.

4. Ask: "Turn these N off? Everything can be restored." Wait for a yes. If they want a different
   set, use `--only pkg1,pkg2` with package names from `candidates`.

5. Apply, only after the yes:

   ```bash
   npx -y quiet-phone apply --yes            # the safe set
   npx -y quiet-phone apply --yes --only com.a.b,com.c.d
   ```

   Report the summary line ("Done. 9 ad services off.") and any failures with their messages.
   Pass on the settings tips it prints: some ads are switched off in Settings, not by removing an
   app. A failure on Xiaomi often means "USB debugging (Security settings)" must be turned on.

6. Tell the owner where the restore record is (the CLI prints it: `~/.quiet-phone/` and
   `Download/quiet-phone-restore.json` on the phone).

## Undo

```bash
npx -y quiet-phone restore            # asks first; pass --yes after the owner agrees
npx -y quiet-phone restore --file quiet-phone-restore-redmi-note-13-2026-10-23.json --yes
```

Restore re-enables what was disabled and runs `cmd package install-existing` for anything that
had to be removed for the user. It is safe to run twice.

## Don't

- Don't run raw `adb shell pm` commands to remove things that aren't on the lists.
- Don't use `--yes` without the owner's yes.
- Don't touch a phone that is on an instalment plan's lock (PayJoy, Knox Guard, Device Lock).
  Quiet Phone refuses those packages; don't work around it.
