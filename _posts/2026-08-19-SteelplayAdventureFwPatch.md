---
title: Fixing the Steelplay Adventure Nintendo Switch Controller
date: 2026-08-19
categories: [Reverse Engineering, Firmware, Gamepad, Bluetooth]
tags: [reverse engineering, firmware, bluetooth]
math: true
image:
  path: /assets/img/steelplayadv/cover.webp
---

Some years ago, I bought myself a cheap game controller from a local store: the Steelplay Adventure for Nintendo Switch (here is the [archived official product page](https://web.archive.org/web/20230606162508/https://www.steel-play.com/jvaswi00099.html), as the original no longer exists).
The controller is intended for use with the Nintendo Switch, acting like a Pro Controller, but I expected it to work on a PC too.
The controller worked fine over USB, but not wirelessly via Bluetooth.
This was unfortunate, as I really wanted to use it as a wireless controller.
Eventually, I put the controller back into its box and continued playing with keyboard and mouse.
I didn't spend time diagnosing the issue.

After two years, I took the controller out of its box again, curious to find out what had prevented it from working wirelessly.
In this blog post, I will cover the process of diagnosing the issue and getting the controller to work wirelessly with my Linux gaming setup.

## Exploring the controller

Before doing any actual Bluetooth diagnostics, I searched the internet for more information about the controller, hoping to find a firmware update that resolved the issue.
The official manual only included basic information, such as entering pairing mode, turning the controller on and off, and adjusting the haptic strength.
It contained no information about firmware updates.

What caught my attention was the button combination needed to enter pairing mode: HOME + B.
When holding these two buttons, the controller LEDs perform a "marching" effect, and the controller appears over Bluetooth under the name "Pro Controller".
I then tried holding HOME + A. The controller LEDs performed a different effect, and the controller advertised itself under a different Bluetooth name and could connect to the PC.
It turns out that the controller can have multiple personalities. The controllers the company sells most likely have identical or nearly identical hardware, so it makes sense to use identical or nearly identical firmware for all of them.
At a high level, Xbox, PlayStation, and Nintendo controllers all have similar hardware: buttons and analog sticks in broadly similar arrangements. The main difference is how they present themselves over the wired or wireless link.

Although HOME + A mode worked, it had a few limitations: neither haptic feedback nor the gyroscope worked, and I wanted to use both.
It was clear that a firmware bug in the regular Nintendo controller mode (HOME + B) was preventing the controller from connecting to the PC.

I continued searching using the controller's PID and VID and noticed many controllers with the same four LEDs and five additional buttons in the center, closely resembling mine.
With more digging, I found out that the combination HOME + X + Y puts the controller in firmware update mode.
I tried multiple firmware-update programs for different controllers, but none worked.

At that point, I stopped looking for "cheap" solutions and moved on to diagnosing the problem.

## Part 1: Diagnosing the problem

In Nintendo Switch mode, the controller uses Bluetooth BR/EDR (Basic Rate/Enhanced Data Rate, also referred to as Bluetooth Classic), not Bluetooth Low Energy (BLE).
I will simply refer to the communication protocol as Bluetooth.

Initially, the controller could pair, authenticate, and enable encryption successfully, but Linux did not end up with a usable Nintendo HID device.
Although pairing succeeded, retrieving the controller's capabilities using the Service Discovery Protocol (SDP) failed.

SDP is a Bluetooth service that can be thought of as a small database running on the Bluetooth device. The PC sends queries to this database.
An SDP record contains attributes describing a service.
The controller is expected to have SDP records for Human Interface Device (HID) and Plug and Play (PnP) information, including vendor and product identifiers.
In our case, these records should match those of a Nintendo Switch Pro Controller, as our controller is trying to emulate one.

### HID service

Before proceeding to the actual problem, it is worth noting a few more things about the HID service.
The idea of the HID service is that the operating system doesn't need to understand every controller from scratch.
Instead, the device provides an HID report descriptor, which describes the format of the reports exchanged between the device and the computer.
Putting it simply, the HID report can be thought of as:

```
byte 0: buttons 1-8
byte 1: buttons 9-16
byte 2: left stick X
byte 3: left stick Y
byte 4: right stick X
byte 5: right stick Y
```

Nintendo controllers use a dedicated Linux driver called [`hid-nintendo`](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-nintendo.c) to handle their device-specific initialization, reports, output, and quirks.
For this driver to be loaded, the Bluetooth stack has to successfully discover the device's HID service.

Bluetooth HID uses two L2CAP channels.
L2CAP is a traffic manager that controls how data flows between higher application layers and the lower radio layer.
L2CAP has a concept called the Protocol/Service Multiplexer (PSM), which acts similarly to the port numbers used by TCP and UDP.
The first HID channel is the HID Control channel on PSM 0x0011, used for control-oriented communication. The second is the HID Interrupt channel on PSM 0x0013, which carries most of the HID traffic.

Having this knowledge, the expected sequence of getting the controller working is:

1. Establish Bluetooth BR/EDR connection
2. Pair and enable encryption
3. Open SDP connection PSM 0x0001
4. Ask the device what services it provides
5. Discover a Human Interface Device service
6. Read the HID service attributes and HID report descriptor
7. Open L2CAP PSM 0x0011 (HID Control)
8. Open L2CAP PSM 0x0013 (HID Interrupt)
9. Start exchanging HID reports

It was clear that the failure occurred at steps 4 and 5, but it was unclear why.
To diagnose the problem, we need to check what the Linux Bluetooth stack (BlueZ) actually received.
For this purpose, we can use the [`btmon`](https://github.com/bluez/bluez/wiki/btmon) utility, a Bluetooth monitor that captures traffic as seen by the Linux stack.
We can save a Bluetooth stack capture with

```shell
sudo btmon -w capture.btsnoop
```

and inspect it later with

```shell
btmon -r capture.btsnoop
```

It is also possible to open `btsnoop` files with [Wireshark](https://www.wireshark.org/).

Instead of manually reading and parsing the capture file, we can use an LLM to help with the task.

After starting a `btmon` capture session, I put the controller in pairing mode and used `bluetoothctl` to interact with BlueZ.
The MAC address of my controller is `A0:5A:5D:47:BF:83`, so I executed the following commands inside `bluetoothctl` (replace the address with that of your controller):

```shell
remove A0:5A:5D:47:BF:83
scan bredr
pair A0:5A:5D:47:BF:83
trust A0:5A:5D:47:BF:83
connect A0:5A:5D:47:BF:83
```

After I tried to connect, the controller disconnected immediately—the issue we are trying to diagnose.

After collecting the `steelplay.btsnoop` file, I used GPT-5.6 Sol (High effort) to inspect the file and find the issue.

Two issues were detected:

1. BlueZ searched SDP for UUID 0x1200, which identifies PnP Information, but received the Nintendo HID record instead of the PnP record.
2. The `ServiceSearchAttributeResponse` also violated the SDP format. Its `AttributeLists` field must be an outer data-element sequence containing one attribute-list sequence per matching service record. The firmware returned the 384-byte HID attribute-list sequence directly, omitting the outer sequence header.

To confirm the issues, we created a simple Python script that allowed us to easily send SDP requests for PnP and HID records, and the result was very interesting: the records were perfectly swapped.
A PnP request returned the HID record, while a HID request returned the PnP record.

```python
#!/usr/bin/env python3

import socket, struct, hashlib
from pathlib import Path

MAC = "A0:5A:5D:47:BF:83"
PNP_HANDLE = 0x00010001
HID_HANDLE = 0x00010000

def sha(data):
    return hashlib.sha256(data).hexdigest()

def connect():
    s = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_SEQPACKET,
                      socket.BTPROTO_L2CAP)
    s.settimeout(8)
    s.connect((MAC, 0x0001))
    return s

def pdu(pdu_id, tid, params):
    return struct.pack(">BHH", pdu_id, tid, len(params)) + params

def search_pattern(uuid16):
    return b"\x35\x03\x19" + struct.pack(">H", uuid16)

def attribute_list():
    return bytes.fromhex("35 05 0A 00 00 FF FF")

def service_search(uuid16):
    print(f"\n{'='*72}\nSERVICE SEARCH UUID 0x{uuid16:04X}\n{'='*72}")

    continuation = b""
    tid = 0x2000
    handles = []
    s = connect()

    try:
        while True:
            params = (search_pattern(uuid16) +
                      struct.pack(">H", 0xFFFF) +
                      bytes([len(continuation)]) + continuation)
            req = pdu(0x02, tid, params)

            print("TX:", req.hex(" "))
            s.sendall(req)
            rsp = s.recv(4096)
            print("RX:", rsp.hex(" "))

            pid, rtid, plen = struct.unpack(">BHH", rsp[:5])
            if pid != 0x03:
                raise RuntimeError(f"expected PDU 03, got {pid:02x}")
            if rtid != tid:
                raise RuntimeError("transaction ID mismatch")

            data = rsp[5:]
            total_count, current_count = struct.unpack(">HH", data[:4])
            pos = 4

            print(f"Total handles:   {total_count}")
            print(f"Current handles: {current_count}")

            for _ in range(current_count):
                handle = struct.unpack(">I", data[pos:pos+4])[0]
                pos += 4
                handles.append(handle)
                print(f"  handle = 0x{handle:08X}")

            clen = data[pos]
            continuation = data[pos+1:pos+1+clen]
            if not continuation:
                break
            tid += 1
    finally:
        s.close()

    return handles

def service_attribute(handle):
    print(f"\n{'='*72}\nSERVICE ATTRIBUTE handle 0x{handle:08X}\n{'='*72}")

    continuation = b""
    tid = 0x3000
    result = bytearray()
    s = connect()

    try:
        while True:
            params = (struct.pack(">I", handle) +
                      struct.pack(">H", 0xFFFF) +
                      attribute_list() +
                      bytes([len(continuation)]) + continuation)
            req = pdu(0x04, tid, params)

            print("TX:", req.hex(" "))
            s.sendall(req)
            rsp = s.recv(4096)
            print("RX:", rsp.hex(" "))

            pid, rtid, plen = struct.unpack(">BHH", rsp[:5])
            if pid != 0x05:
                raise RuntimeError(f"expected PDU 05, got {pid:02x}")
            if rtid != tid:
                raise RuntimeError("transaction ID mismatch")

            data = rsp[5:]
            fragment_len = struct.unpack(">H", data[:2])[0]
            fragment = data[2:2+fragment_len]
            result.extend(fragment)

            pos = 2 + fragment_len
            clen = data[pos]
            continuation = data[pos+1:pos+1+clen]

            print(f"fragment={fragment_len} "
                  f"continuation={continuation.hex() or '<end>'}")

            if not continuation:
                break
            tid += 1
    finally:
        s.close()

    result = bytes(result)
    print(f"\nLength: {len(result)} / 0x{len(result):X}")
    print(f"SHA256: {sha(result)}")
    print("First bytes:", result[:32].hex(" "))
    return result

def main():
    print("\nSTEP A: UUID -> handle\n")
    pnp_search = service_search(0x1200)
    hid_search = service_search(0x1124)

    print(f"\n{'='*72}\nSEARCH SUMMARY\n{'='*72}")
    print("UUID 0x1200 handles:", [f"0x{x:08X}" for x in pnp_search])
    print("UUID 0x1124 handles:", [f"0x{x:08X}" for x in hid_search])

    print("\nSTEP B: handle -> record\n")
    hid_record = service_attribute(HID_HANDLE)
    pnp_record = service_attribute(PNP_HANDLE)

    Path("sdp_handle_10000.bin").write_bytes(hid_record)
    Path("sdp_handle_10001.bin").write_bytes(pnp_record)

    print(f"\n{'='*72}\nDIRECT HANDLE SUMMARY\n{'='*72}")
    print("handle 0x00010000:", len(hid_record), sha(hid_record))
    print("handle 0x00010001:", len(pnp_record), sha(pnp_record))

if __name__ == "__main__":
    main()
```
{: file='sdp_matrix_inspect.py'}

Of these two issues, the first looked easy to patch at the firmware level, but the second seemed more difficult.
Before patching either one, however, we first needed a way to extract the device's firmware.

## Part 2: Extracting the firmware

We had already found a way to put the controller into firmware-update mode by holding HOME + X + Y.
Once in firmware-update mode, the controller appeared in a USB-device listing from a tool such as `lsusb` as:

```
BR23 UBOOT1.00
USB VID:PID 4c4a:2342
```

The BR23 identifier helped identify the actual chip used in the controller.
BR23 is an internal identifier for the AC635N/AC695N series of chips developed by [JieLi Tech](https://doc.zh-jieli.com/vue/#/docs/ac63).
It uses the `pi32v2` architecture, which becomes important when selecting binary utilities from the toolchain.
With this information, it was easy to find an open-source tool for interacting with the USB download mode (referred to as UBOOT): [`jl-uboot-tool`](https://github.com/kagaimiq/jl-uboot-tool).
The tool can read and write the flash of BR23 chips while they are in UBOOT mode.

The tool is written in Python and is easy to set up.
I created a virtual environment to run the provided `jluboottool.py` script.
On Linux, ensure that the `sg` module is loaded (`modprobe sg`).

Once the tool is started, it shows the following output if it recognizes the connected chip:

```
Searching for "br23" devices..
Found a device: BR23 UBOOT1.00 (1.00) at /dev/sg2
Waiting for [/dev/sg2] try! ok (BR23 UBOOT1.00 1.00)

Chip: BR23 - AC635N/AC695N series
Running loader with argument 0x0001.
The Loader has been successfully installed.

================ Quick info ==================
  ** BR23 (AC635N/AC695N series) **
  >> Chip key: 0xA80F <<
  - Online device:
     ID: 0xeb6014
     Type: 0x03 (SPI NOR flash on SPI0)
==============================================

  .------------------------------------------------------.
  |     _____________   .------------------------------. |
  |    /___  __  ___/   |       JieLi UBOOT Tool         |
  |       / / / /       |        - Das Shell -           |
  |  __  / / / /        `------------------------------. |
  | / /_/ / / /____        -*- JieLi tech console -*-  | |
  | `____/ /______/       Type 'help' or '?' for help. | |
  |                     `------------------------------' |
  `------------------------------------------------------'
=>JL:
```
{: file='.venv/bin/jluboottool.py --chip br23'}

To dump the firmware, we need to specify the flash range to read.
From the SPI NOR flash's reported JEDEC ID, `0xeb6014`, we can determine that its capacity is 8 Mbit (1 MiB). We can therefore dump the entire flash to a file by entering:

```shell
read 0 0x100000 steelplay-original-full.bin
```

After dumping the firmware, we need to determine the structure of the firmware format used by BR23 chips.

## Part 3: Decoding the firmware file

If we inspect the original firmware dump, it appears to be encrypted or scrambled.
A simple `strings` command produces nothing intelligible, supporting that conclusion.
This is another point where LLMs have proven to be very instrumental.
The LLM found the required resources and provided code that could descramble the firmware file.

The relevant implementation comes from the community reverse-engineering project [JieLi Misc Tools](https://github.com/kagaimiq/jl-misctools), specifically its firmware unpacker, [`fwunpack_newfw.py`](https://github.com/kagaimiq/jl-misctools/blob/main/firmware/fwunpack_newfw.py).

It turns out that the firmware is not encrypted with AES. Instead, it is scrambled with a proprietary LFSR-based XOR stream cipher.
The top-level metadata uses this cipher with the fixed key `0xFFFF`.
This metadata forms a lightweight flash file system called JLFS, which organizes firmware components and stores their names, offsets, sizes, and attributes.
Besides the generic information needed by the bootloader, it describes the application firmware (typically `app.bin`) and includes a file containing the encoded chip key (typically `isd_config.ini`).
The application area uses a variation associated with JieLi's SPI Flash Controller (SFC). It is processed in 32-byte blocks, each using an initial key derived from the chip key and the block address.
The chip key was visible when we ran the `jl-uboot-tool` script; in our case, it was `0xA80F`.

Using this information, we can extract the application firmware as a binary file, `steelplay-app.bin`.

## Part 4: Disassembly of the application firmware

The binary application firmware is difficult to inspect directly, so we need to generate a disassembly listing from it.
The [AC63 SDK linker script](https://github.com/Jieli-Tech/fw-AC63_BT_SDK/blob/master/cpu/br23/sdk_ld.c) defines `CODE_BEG` as `0x01E000C0` and the `code0` executable region as starting at `0x01E00120`. Because `steelplay-app.bin` includes the 0x60 bytes preceding the executable region, we map the beginning of the complete blob to `0x01E000C0`:
The disassembly can be generated with `objdump` from the binary machine code:

```shell
OBJDUMP=<PATH_TO_JIELI_TOOLCHAIN>/pi32v2/bin/objdump
"$OBJDUMP" \
    -D \
    -b binary \
    -m pi32v2 \
    --adjust-vma=0x01e000c0 \
    --start-address=<START_ADDR> \
    --stop-address=<END_ADDR> \
    steelplay-app.bin \
    > steelplay-disasm.txt
```

Here, `--start-address` and `--stop-address` specify the range of CPU addresses to disassemble.
If we omit them, `objdump` disassembles the entire binary file.
This lets us decode a selected range of the binary application as PI32V2 instructions and display the corresponding CPU addresses.

### Bug 1: Finding the PnP and HID arrays

To resolve the first bug, where SDP returned the HID array when asked for PnP information and vice versa, we first locate the actual PnP and HID arrays in the firmware.
We expect their addresses to be swapped in the function that prepares SDP responses.
For this purpose, we scan `steelplay-app.bin` for the SDP response bytes collected with `btmon`.
We found both matches in the decrypted application binary. Because `app.bin` begins at offset `0x30E0` in the full firmware image, the offsets are related by `fw_offset = app_offset + 0x30E0`:

|                        | HID          | PnP          |
| :--------------------- | :----------- | :---------   |
| app binary offset      | 0x20ACA      | 0x20591      |
| fw binary offset       | 0x23BAA      | 0x23671      |
| size (bytes)           | 0x0180 (384) | 0x008F (143) |

We expect a procedure in the code to contain the equivalent of a call such as `sdp_send_response(sdp_data, data_length)`.
With the help of the LLM, we can inspect the disassembly and find the relevant procedure, which would take time to locate manually.
The addresses are specified indirectly, so we first search by array size—which produces multiple matches—and then identify the array addresses in the surrounding code.
The equivalent C code that the LLM found in the disassembly is:

```c
if (uuid == PNP_UUID) {
    ptr = HID_record;
    len = sizeof(HID_record);
}
else if (uuid == HID_UUID) {
    ptr = PNP_record;
    len = sizeof(PNP_record);
}
send_response(..., ptr, len);
```

Patching the first issue is therefore straightforward: we need to swap the `ptr` assignments in the conditional branches.
But before patching, we must fix the second issue too.

### Bug 2: wrapping the records with the outer sequence

We know that the second issue is the missing outer `AttributeLists` sequence header in the SDP `ServiceSearchAttributeResponse`.
Conceptually, the equivalent C code in the firmware is:

```c
// Bug 1: wrong record selection
if (uuid == PNP_UUID)
    select(HID);

if (uuid == HID_UUID)
    select(PNP);


// Bug 2: invalid response (missing outer sequence)
send(inner_attribute_list);
```

Instead, we want the selection logic to be equivalent to:

```c
if (uuid == PNP_UUID)
    select(wrapped_PNP);

if (uuid == HID_UUID)
    select(wrapped_HID);

```

where

```
wrapped_PNP =
    36 00 8f
    + original 143-byte PnP record

wrapped_HID =
    36 01 80
    + original 384-byte HID record
```

The quickest way to fix this issue is to find space in the firmware for the wrapped records.
We need a total of 387 + 146 = 533 bytes.
Because the controller has multiple personalities, we can repurpose an SDP record belonging to another personality; we are interested only in making the Nintendo controller mode work.
The application firmware contains a 683-byte record, with its size derived from the header bytes, so we chose that location for the wrapped records (address range `0x243C3..0x2466D`, inclusive).
The entire surrounding region contains static SDP profile data rather than executable code, so several locations could accommodate the wrapped records.

Once we had this plan in motion, it was quite trivial to patch the firmware code.

## Part 5: Patching the firmware

Patching the decrypted firmware file was a matter of replacing bytes.
We replaced the addresses of the original SDP records with those of our wrapped records.
The application firmware also had CRCs that we needed to recompute to keep the image valid.
This produced the patched, decrypted firmware.
Finally, we applied the same scrambling scheme again to produce a flashable image, processing the modified headers and application binary.

With this, we got the new patched firmware ready for testing on the controller.

## Part 6: Finding the final issue

The patched firmware can be flashed using `jluboottool` while the controller is in USB firmware-update mode.
After flashing the firmware, we proceeded with the usual pairing and connection process, but the controller was still not connecting.
We used `btmon` again and found another issue: the patch was necessary but not sufficient.
We saw that BlueZ performed the following queries and got the following responses:

```
1. Query UUID 0x0100: empty response
2. Query UUID 0x1200: PnP response
3. Query UUID 0x1002: empty response
```

There was no query for the HID UUID `0x1124`, explaining why the device was not enumerated as a HID device.

The first empty response was for a service-search pattern containing UUID `0x0100`, the L2CAP protocol UUID. The second was for UUID `0x1002`, `PublicBrowseRoot`.
Our initial hypothesis was that the missing `PublicBrowseRoot` response mattered. It should match the publicly browsable SDP records—in our case, an aggregate containing the HID and PnP attribute lists.
We created this aggregate and patched the firmware to return it for a query containing UUID `0x1002`, but the device still was not enumerated as HID.

With the help of the LLM, we inspected BlueZ's service-search path. The initial search for records containing UUID `0x0100` was the important one because both of our service records contained the L2CAP protocol UUID.
We therefore needed to return the aggregate in response to the `0x0100` search.
After creating and flashing this final patch, the device was enumerated as HID and worked well with the `hid_nintendo` driver.

All steps are implemented in the following Python CLI, which accepts the original scrambled firmware dump as input.

> **Warning:** These byte-level patches support only the verified stock firmware build identified by the hashes in the script. Back up the original dump before flashing anything. An incompatible or interrupted flash may leave the controller unusable.

```python
#!/usr/bin/env python3
import argparse, hashlib, struct
from pathlib import Path
from collections import namedtuple

# Steelplay Adventure / JieLi BR23 (AC63) firmware tool.
# Patches are build-specific; decryption/JLFS discovery is structural.
STOCK_ENC="c48d8aef2dd147b77bed0418ff915f9ba6e00d17ef8e371c2260443741929e36"
STOCK_DEC="a5f561638fc99efa4bcc33f851b2be72548f911c99c7ebfd07cc18ca0633a64d"
EXPECTED={
 "patch1":("1a19279c538eb1eca7fd415954cabca3941ce576dabd055cdfb7d9f134e9af0f","db107232531ed7db8c1d6c894e8451fd4421c063dd87fbc43794d0132e702ba5"),
 "patch2":("1fcd6f1a81f6477d22c58df1bec187462292782ad8778a2c5278066625c07988","ae2b854bdff13f4333872e5882be4d70b80d8d2f7a080493a4c0928b41318923"),
 "patch3":("b7b3c58d627f367a62d5a9c06ca1bd5bfbeeca0148be1404f84629d06cc5da0e","c864d74b3d07720e9b890da73f9b1b63484849c7514d6f121376ac1a32558482")}
E=namedtuple("Entry","hdr crc off size flags reserved index name data data_size")

PNP,PNP_SZ,HID,HID_SZ=0x23671,0x8f,0x23baa,0x180
WPNP,WHID,AGG=0x243c3,0x24455,0x2466e
BASE=[
 ("UUID selector",0xe926,"00 ff 12 20 34 01 43 e0 11 24 83 e8 05 20","02 f8 05 24 43 e0 11 24 83 e8 06 20 94 90"),
 ("PnP redirect",0xe934,"64 2f 92 17 13 e1 c1 be","64 32 42 e0 13 2c 94 90"),
 ("HID redirect",0xeb94,"44 e0 80 01 42 e0 fa 23","44 e0 83 01 42 e0 a5 2c")]
STUB=("aggregate stubs",0xe90c,
 "02 f8 ee 02 43 e0 11 24 03 e8 ea 20 82 f8 11 24 5c 2e 92 17 13 e1 4e bd 94 9e",
 "44 22 92 17 03 e1 0c 80 a4 86 00 00 00 00 00 00 44 e0 12 02 42 e0 be 2e 94 9b")
SEL2=("UUID 0x1002 selector",0xe93e,"44 22 92 17 03 e1 0c 80 94 8d","43 e0 10 02 03 e8 eb 21 f7 82")
SEL3=("UUID 0x0100 selector",0xe93e,"44 22 92 17 03 e1 0c 80 94 8d","02 f8 ed 03 f7 84 00 00 00 00")

def sha(x): return hashlib.sha256(x).hexdigest()
def align(x,a=32): return (x+a-1)//a*a
def sstr(x): return x.split(b"\0",1)[0].decode("ascii","replace")
def crc16(x):
    c=0
    for b in x:
        c^=b<<8
        for _ in range(8): c=(((c<<1)^0x1021) if c&0x8000 else c<<1)&0xffff
    return c
def enc(b,o,n,k=0xffff):
    for i in range(n):
        b[o+i]^=k&0xff; k=((k<<1)^(0x1021 if k&0x8000 else 0))&0xffff
def sfc(b,o,n,base,key):
    for i in range(0,n,32): enc(b,o+i,min(32,n-i),key^(((o+i)-base)>>2))
def chipkey(x):
    t=sum(x[:16])&0xff; t=0xaa if t>=0xe0 else 0x55 if t<=0x10 else t; k=0
    for i in range(16):
        if (x[16+i]^x[15-i])<t: k|=1<<i
    return k

def flash_header(raw):
    for o in (0,0x1000,0x10000,0x80000,0x100000,0x180000):
        if o+32>len(raw): continue
        h=bytearray(raw[o:o+32]); enc(h,0,32)
        if int.from_bytes(h[:2],"little") and crc16(h[2:])==int.from_bytes(h[:2],"little"):
            h=h[:4]+raw[o+4:o+8]+h[8:16]+raw[o+16:o+32]
            _,burn,ver,sz,fsv,al,_,_,prod=struct.unpack("<HH4sIBBBB16s",h)
            return o,burn,sstr(ver),sz,fsv,al,sstr(prod.rstrip(b"\xff"))
    raise RuntimeError("no valid JieLi flash header")

def parse_entry(b,o,base,after=False):
    hc,h=struct.unpack_from("<H30s",b,o)
    if crc16(h)!=hc: raise RuntimeError(f"JLFS header CRC error @ 0x{o:x}")
    dc,eo,sz,fl,rs,idx,n=struct.unpack("<HIIBBH16s",h)
    data=o+32 if after else base+eo; ds=o+sz-data if after else sz
    return E(o,dc,eo,sz,fl,rs,idx,sstr(n),data,ds)

def top_entries(b,base,crypt=False):
    out=[]; o=base+32
    while True:
        if crypt: enc(b,o,32)
        e=parse_entry(b,o,base); out.append(e)
        if e.index: return out
        o+=32

def sfc_entries(b,base,key=None):
    out=[]; rel=0; done=base
    while True:
        o=base+rel
        if key is not None:
            t=align(o+32)
            if done<t: sfc(b,done,t-done,base,key); done=t
        e=parse_entry(b,o,base,True); out.append(e); rel+=e.size; nxt=base+rel
        if key is not None:
            t=nxt if e.index else align(nxt+32)
            if done<t: sfc(b,done,t-done,base,key); done=t
        if e.index: return out,nxt

def nested_entries(b,area):
    out=[]; o=area.hdr+32
    while True:
        e=parse_entry(b,o,area.hdr); out.append(e)
        if e.index: return out
        o+=32

def locate_decrypted(b,top=None,sents=None):
    base=flash_header(bytes(b))[0]
    top=top or top_entries(b,base)
    isd=next(e for e in top if e.name=="isd_config.ini")
    blob=bytes(b[isd.data:isd.data+32]); stored=int.from_bytes(b[isd.data+32:isd.data+34],"little")
    if crc16(blob)!=stored: raise RuntimeError("isd_config chip-key CRC mismatch")
    key=chipkey(blob); appdir=next(e for e in top if e.name=="app_dir_head")
    sents,end=sents or sfc_entries(b,appdir.data,None)
    area=next((e for e in sents if e.name=="app_area_head"),sents[0])
    app=next(e for e in nested_entries(b,area) if e.name=="app.bin")
    return dict(base=base,top=top,key=key,sfc_base=appdir.data,sfc_end=end,area=area,app=app)

def decrypt(raw):
    base,*hdr=flash_header(raw); b=bytearray(raw); top=top_entries(b,base,True)
    isd=next(e for e in top if e.name=="isd_config.ini"); blob=bytes(b[isd.data:isd.data+32])
    if crc16(blob)!=int.from_bytes(b[isd.data+32:isd.data+34],"little"): raise RuntimeError("isd_config CRC mismatch")
    key=chipkey(blob); appdir=next(e for e in top if e.name=="app_dir_head"); sents,end=sfc_entries(b,appdir.data,key)
    info=locate_decrypted(b,top,(sents,end))
    print(f"header=0x{base:x}, version={hdr[1]}, product={hdr[-1]}, FS={hdr[3]}, chip_key=0x{key:04x}")
    print(f"SFC=0x{info['sfc_base']:x}..0x{end:x}, app.bin=0x{info['app'].data:x}+0x{info['app'].data_size:x}")
    return b,info

def fix_crcs(b,info):
    app,area=info["app"],info["area"]
    ac=crc16(b[app.data:app.data+app.data_size]); struct.pack_into("<H",b,app.hdr+2,ac)
    ah=crc16(b[app.hdr+2:app.hdr+32]); struct.pack_into("<H",b,app.hdr,ah)
    rc=crc16(b[area.data:area.hdr+area.size]); struct.pack_into("<H",b,area.hdr+2,rc)
    rh=crc16(b[area.hdr+2:area.hdr+32]); struct.pack_into("<H",b,area.hdr,rh)
    print(f"CRCs: app=0x{ac:04x}/0x{ah:04x}, app_area=0x{rc:04x}/0x{rh:04x}")

def reencrypt(dec):
    b=bytearray(dec); info=locate_decrypted(b); fix_crcs(b,info)
    sfc(b,info["sfc_base"],info["sfc_end"]-info["sfc_base"],info["sfc_base"],info["key"])
    for e in info["top"]: enc(b,e.hdr,32)
    return bytes(b),bytes(dec),info

def put(b,p):
    name,o,old,new=p; old,new=bytes.fromhex(old),bytes.fromhex(new)
    if bytes(b[o:o+len(old)])!=old: raise RuntimeError(f"{name}: stock bytes mismatch @ 0x{o:x}")
    if len(old)!=len(new): raise RuntimeError(f"{name}: size-changing code patch")
    b[o:o+len(new)]=new; print(f"patch: {name} @ 0x{o:x}")

def apply_patch(stock,kind):
    if sha(stock)!=STOCK_DEC: raise RuntimeError("patches only support the verified stock decrypted image")
    b=bytearray(stock); info=locate_decrypted(b)
    pnp,hid=bytes(b[PNP:PNP+PNP_SZ]),bytes(b[HID:HID+HID_SZ])
    if pnp[:3]!=bytes.fromhex("36 00 8c") or hid[:3]!=bytes.fromhex("36 01 7d"): raise RuntimeError("Nintendo SDP records mismatch")
    for p in BASE: put(b,p)
    wp=b"\x36"+len(pnp).to_bytes(2,"big")+pnp; wh=b"\x36"+len(hid).to_bytes(2,"big")+hid
    if len(wp)!=0x92 or len(wh)!=0x183 or WPNP+len(wp)!=WHID: raise RuntimeError("wrapper layout mismatch")
    b[WPNP:WPNP+len(wp)]=wp; b[WHID:WHID+len(wh)]=wh
    if kind!="patch1":
        put(b,STUB); put(b,SEL2 if kind=="patch2" else SEL3)
        agg=b"\x36"+(len(hid)+len(pnp)).to_bytes(2,"big")+hid+pnp
        if len(agg)!=0x212: raise RuntimeError("aggregate length mismatch")
        b[AGG:AGG+len(agg)]=agg
    fix_crcs(b,info); return bytes(b),info

def outname(inp,s): return inp.with_name(inp.stem+s+".bin")
def write(p,data,label): p.write_bytes(data); print(f"{label}: {p} ({len(data):#x}, sha256={sha(data)})")

def main():
    ap=argparse.ArgumentParser(description="Steelplay Adventure BR23 decrypt/patch/re-encrypt tool")
    sp=ap.add_subparsers(dest="cmd",required=True)
    d=sp.add_parser("decrypt"); d.add_argument("input",type=Path); d.add_argument("-o",type=Path); d.add_argument("--app-out",type=Path)
    e=sp.add_parser("encrypt"); e.add_argument("input",type=Path); e.add_argument("-o",type=Path)
    p=sp.add_parser("patch"); p.add_argument("input",type=Path); p.add_argument("patch",choices=("patch1","patch2","patch3")); p.add_argument("--decrypted-out",type=Path); p.add_argument("--app-out",type=Path); p.add_argument("--flash-out",type=Path)
    a=ap.parse_args(); raw=a.input.read_bytes()
    if a.cmd=="decrypt":
        dec,info=decrypt(raw); write(a.o or outname(a.input,"-decrypted"),dec,"decrypted")
        write(a.app_out or outname(a.input,"-app"),dec[info["app"].data:info["app"].data+info["app"].data_size],"app.bin")
        return
    if a.cmd=="encrypt":
        encfw,_,_=reencrypt(raw); write(a.o or outname(a.input,"-flash"),encfw,"flash"); return
    if sha(raw)==STOCK_ENC: dec,info=decrypt(raw)
    elif sha(raw)==STOCK_DEC: dec=raw; info=locate_decrypted(bytearray(dec))
    else: raise RuntimeError("patch input must be the verified stock encrypted or decrypted dump")
    patched,info=apply_patch(dec,a.patch)
    flash,_,_=reencrypt(patched)
    dexp,fexp=EXPECTED[a.patch]
    if sha(patched)!=dexp or sha(flash)!=fexp: raise RuntimeError(f"{a.patch}: output hash mismatch")
    base=a.input.with_suffix("")
    write(a.decrypted_out or Path(str(base)+f"-{a.patch}-decrypted.bin"),patched,"patched decrypted")
    write(a.app_out or Path(str(base)+f"-{a.patch}-app.bin"),patched[info["app"].data:info["app"].data+info["app"].data_size],"patched app.bin")
    write(a.flash_out or Path(str(base)+f"-{a.patch}-flash.bin"),flash,"patched flash")

if __name__=="__main__": main()
```
{: file='steelplay_fw_tool.py'}

Usage:

```shell
# 1. Decrypt original firmware dump, produces
#   - steelplay-original-full-decrypted.bin
#   - steelplay-original-full-app.bin

python steelplay_fw_tool.py decrypt steelplay-original-full.bin

# 2. Apply a patch and generate the patched app firmware, decrypted full firmware and final full firmware
# patch1: fix PnP and HID selection with correct wrapped records
# patch2: fix PnP and HID selection with correct wrapped records plus HID + PnP aggregate for UUID 0x1002
# patch3 (final): fix PnP and HID selection with correct wrapped records plus HID + PnP aggregate for UUID 0x0100

python steelplay_fw_tool.py patch steelplay-original-full.bin patch1
python steelplay_fw_tool.py patch steelplay-original-full.bin patch2
python steelplay_fw_tool.py patch steelplay-original-full.bin patch3
```

{: file='steelplay_fw_tool usage'}

## Kudos to LLMs

Finding the bug required understanding many concepts that would otherwise have taken a great deal of time to research.
The work ranged from understanding Bluetooth service discovery, collecting and analyzing Bluetooth traces, and researching existing tools and SDKs (`jl-uboot-tool` and the AC63 SDK) to reading assembly instructions and working through dead ends. It is remarkable how LLMs can make knowledge from across the internet easier to access and apply while helping us learn new things.

## Conclusion

It is unfortunate that the controller did not work out of the box on a PC as I had hoped.
Having functional hardware rendered unusable by firmware issues is frustrating.
Sadly, products in this price range are not typically expected to receive firmware fixes for a use case like mine, especially when the controller was not intended for that use case.

Nevertheless, it became an interesting side project that helped me learn valuable new concepts and skills.
It feels great to have the controller finally connect to my Linux gaming machine with all of its functionality available.
