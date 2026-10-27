# CFW profile protocol (VCU `0x16`)

This document describes the profile interface reconstructed from the lizenzcode firmware and the separate Compat 1.6.2 port. G3 Connect uses the existing remembered-key/Power-button pairing and Encryption2 transport; the profile code does not introduce another BLE service or key exchange.

## Configure profiles in G3 Connect

1. Open **Roller**, connect, and complete the normal Power-button authentication.
2. Open **Profile** and select **Profile auslesen**. This reads the version, active-profile bit, unlock sequence, and 16-byte settings block.
3. Edit the normal and tuning profiles. The displayed VCU maximum is applied separately to every Race and Sport value.
4. Enter 3–19 events for the unlock sequence. Spaces, commas, and semicolons are accepted.
5. Keep the scooter stationary and select **Schreiben + prüfen**. Each changed block is written once, then read back.
6. Restart normally and read again to verify persistence. The immediate readback proves RAM state, not survival across power loss.

There is deliberately no remote “switch profile” button. The configured physical input sequence enters the tuning profile. With **Panic Button** enabled, the Boost/Custom button returns it to the normal profile.

## Input sequence

Block 0 is exactly 20 bytes. A zero terminates the sequence. The port therefore accepts at most 19 events plus the terminator. The original web client required at least 3 inputs and allowed 20 UI entries; this mirror keeps its 3-input UI minimum but reserves the final firmware byte for the terminator.

| ID | G3 control named by the original client |
|---:|---|
| `1` | Left brake released |
| `2` | Right brake released |
| `4` | Next button |
| `5` | Previous button |
| `6` | Left button |
| `7` | Right button |
| `8` | Boost/Custom button |

The port default is `1 1 1 1 1 2 2 2 2 2`. The supplied HAR also captured successful round trips for `2 1 2 1 1 6 7` and `2 1 2 1 1 6 4`.

## Settings block

Block 1 is exactly 16 bytes:

| Offset | Original-client meaning | Local API field |
|---:|---|---|
| 0 | Normal Race limit, km/h | `normal.low` |
| 1 | Normal Sport limit, km/h | `normal.high` |
| 2 | Tuning Race limit, km/h | `alternate.low` |
| 3 | Tuning Sport limit, km/h | `alternate.high` |
| 4 | Live maximum for byte 0 (read-only) | `limits[0].low` |
| 5 | Live maximum for byte 1 (read-only) | `limits[0].high` |
| 6 | Live maximum for byte 2 (read-only) | `limits[1].low` |
| 7 | Live maximum for byte 3 (read-only) | `limits[1].high` |
| 8 | Normal underglow | `normal.flag4` |
| 9 | Tuning underglow | `alternate.flag4` |
| 10 | Normal front light bar | `normal.flag800` |
| 11 | Tuning front light bar | `alternate.flag800` |
| 12 | Normal cruise control | `normal.cruise` |
| 13 | Tuning cruise control | `alternate.cruise` |
| 14 | Panic button / return on Boost/Custom | `autoReturn` |
| 15 | Beep on profile switch | `beep` |

The field names were correlated in two independent ways: the original client/HAR returned normal Race/Sport `22/22`, tuning Race/Sport `0/45`, and false/true feature pairs; the emulated port returned `16 16 00 2d 16 16 00 2d 00 01 00 01 00 01 01 01`. The firmware applies bytes 8–11 through register `0x1F` masks `0x0004` and `0x0800`.

## Model capabilities and editable fields

The original client gates each field by a per-model capability table before showing it. For the **G3** the table is:

| Capability | G3 value |
|---|---|
| `inputs` | `1` left brake, `2` right brake, `4` next, `5` previous, `6` left, `7` right, `8` Boost/Custom |
| `hasRaceMode` | **false** |
| `hasUnderglowLights` | true |
| `hasFrontLightBar` | true |
| `hasCruiseControl` | true |
| `hasPanicButton` | true |

Because `hasRaceMode` is false, the G3 has **no Race mode**: the original client never exposes the Race limit for editing. Bytes 0 and 2 (`normal.low` / `alternate.low`, the Race values) are therefore read-only in this port — read with the block and written back unchanged — and only bytes 1 and 3 (the Sport limits) are user-editable. In the HAR capture the G3 reports normal Race `22` (equal to its Sport limit) and tuning Race `0`.

Every editable Sport value has a firmware-client floor of **15 km/h** (`settings.validation.minimumSpeed`, min `15`) and a ceiling taken from the live VCU byte (bytes 5 and 7). Values outside that range are rejected before any `F2` write.

## Clear VCU commands

The normal Ninebot frame addresses host `0x3E` to VCU `0x16`. Encryption2 wraps these bytes on GATT.

| Operation | Command | Selector/index | Payload | Expected reply |
|---|---:|---:|---|---|
| Read sequence | `F1` | `00` | empty | `F4 00` + 20 bytes |
| Read settings | `F1` | `01` | empty | `F4 01` + 16 bytes |
| Write sequence | `F2` | `00` | exactly 20 bytes | `F5 00`, empty |
| Write settings | `F2` | `01` | exactly 16 bytes | `F5 01`, empty |

Known clear-frame examples (checksum bytes omitted):

```text
read sequence request   5a a5 00 3e 16 f1 00
read settings request   5a a5 00 3e 16 f1 01
read sequence response  5a a5 14 16 3e f4 00 <20 bytes>
read settings response  5a a5 10 16 3e f4 01 <16 bytes>
write sequence ACK      5a a5 00 16 3e f5 00
write settings ACK      5a a5 00 16 3e f5 01
```

The complete request/reply vectors are in `tests/profiles-firmware.json`. At GATT level an encrypted F2 sequence request is 33 bytes and an encrypted F2 settings request is 29 bytes; notifications may arrive fragmented and are reassembled by the existing `Ninebot.request()` path.

## Capability and consistency rules

- CFW is detected by the F1/F2 profile protocol itself: a device is treated as writable when both F1 blocks (index 0/1) read back and decode as the valid AA03 block layout. Register `0x17` is only displayed; the CFW firmware deliberately advertises a stock-looking version (e.g. `0x162`) for stealth, so it is not used as the gate. A device whose F1 blocks do not decode is read-only.
- Standard register `0x1D`, bit `0x0002`, reports the active profile.
- Standard register `0x57` must be zero before each changed block is sent.
- Reads sample the active bit before and after both blocks and retry once if it changed.
- Writes compare a fresh snapshot with the displayed snapshot, send only changed blocks, and read each block back.
- An absent F5 is never blindly retried. One F1 readback can prove that the RAM change arrived; a mismatch stops the operation and reports already-confirmed blocks.
- The two blocks are not an atomic transaction.

## Evidence and test boundary

- The original JavaScript was decoded statically to recover the G3 input map and UI field names. The supplied HAR was inspected offline and sanitized before creating `tests/profiles-original-client.json`; license, device identity, serial, pairing material, and encrypted traffic are not included.
- Eleven vectors run through the stock BLE 0.4.5 clear dispatcher/serializer and the actual ported VCU UART parser/serializer under emulation.
- Node tests cover Encryption2, remembered pairing, fragmented GATT notifications, exact outbound frames, stale snapshots, disconnects, and UI state.
- These tests do not claim a physical-radio or road test. Confirm persistence and visible behavior on the scooter after a normal restart.
