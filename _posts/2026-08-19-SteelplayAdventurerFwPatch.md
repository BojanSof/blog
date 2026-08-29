---
title: Fixing Steelplay Adventure Nintendo Switch Controller
date: 2026-03-30
categories: [Reverse Engineering, Firmware, Gamepad, Bluetooth]
tags: [reverse engineering, firmware, bluetooth]
math: true
image:
  path: /assets/img/steelplayadv/cover.webp
---

Some year ago, I bought myself cheap game controller from a local store, Steelplay Adventure for Nintendo Switch (the official link of the product on [archive](https://web.archive.org/web/20230606162508/https://www.steel-play.com/jvaswi00099.html), as the official web page doesn't exist anymore).
The controller is intended to be used with Nintendo Switch, acting same as the Pro Controller, but I was expecting it to work on PC too.
The controller was working fine with USB, but it was just not working wirelessly, via Bluetooth.
This was very unfortunate, as I really wanted to use it as wireless controller.
Eventually, I put the controller back into its box and continued playing with keyboard and mouse.
I didn't spend time diagnosing the issue.

After 2 years, I got the controller out of its box again and I was curious to see what the issue was that stopped me from getting the controller working wirelessly.
In this blog post, I will cover the process of diagnosing the issue and getting the controller to work wirelessly with my Linux gaming configuration.

## Exploring the controller

Before doing any actual Bluetooth diagnosing, I searched around the internet to find more info about the controller, hoping to find firmware update that resolves the issue.
The official manual only included basic information, such as entering pairing mode, turning the controller ON and OFF, adjusting haptic strength and similar things.
No info about firmware updates.

What got interesting to me is the combination that was needed to enter pairing mode: HOME + B.
When holding this two buttons, the controller LED lights perform "marching" effect and the controller comes out with the name "Pro Controller" via Bluetooth.
Then, I tried holding HOME + A and the controller LED lights started performing another effect and the controller was advertising on Bluetooth under different name and was able to connect to PC.
It turns out the controller can have multiple personalities - most probably the controllers the company sells have identical or nearly identical hardware design, so it is natural to use identical or nearly identical firmware for all of them.
If we think in more depth, it is natural that all controllers, Xbox, Playstation and Nintendo are very similar in terms of the same hardware, they all have buttons, analog sticks, typically in very similar arrangment, but they differ in how they present themselves over the wireless link.

Now, although the HOME + A mode was working, there were few issues, such as the haptic wasn't working, the gyro was not working, which I really wanted to get running.
It was clear that there was some firmware bug for the regular Nintendo controller mode (HOME + B), that was preventing the controller to connect with PC.

I carried on searching with the PID and VID for the controller, and noticed that there are many controllers that have same 4 LED lights, 5 additional buttons in the center, greatly reassembling the controller I have.
With more digging, I found out that the combination HOME + X + Y puts the controller in firmware update mode.
I tried multiple firmware update programs for different controllers, but none were working.

Then, I've stopped finding "cheap" solutions and moved to diagnosing the problem.

## Part 1: Diagnosing the problem

In Nintendo switch mode, the controller uses Bluetooth BR/EDR (Basic Rate / Enhanced Data Rate, also referred to as Bluetooth Classic), not Bluetooth Low Energy (BLE).
I will simply refer to the communication protocol as Bluetooth.

Initially the controller could pair, authenticate and encrypt successfully, but Linux did not end up with a usable Nintendo HID device.
Although pairing was successful, retrieving the controller capabilities using Service Discovery Protocol (SDP) was failing.

SDP is Bluetooth service, which can simply be thought as small database running on the Bluetooth device, and the PC sends queries to this database.
The SDP record contains attributes describing the service.
The controller is expected to have SDP records for Human Interface Device (HID) and Plug and Play (PnP) information, describing the manufacturer and product ID.
In our case, these records should match Nintendo Switch Pro Controller ones, as our controller is trying to emulate the Nintendo controller.

### HID service

Before proceeding to actual problem, it is worth noting few more things about the HID service.
The idea of the HID service is that the operating system doesn't need to understand every controller from scratch.
Instead, the device provides HID report descriptor, which describes the format of the reports exchanged between the device and the computer.
Putting it simply, the HID report can be thought of as:

```
byte 0: buttons 1-8
byte 1: buttons 9-16
byte 2: left stick X
byte 3: left stick Y
byte 4: right stick X
byte 5: right stick Y
```

The Nintendo controller HID descriptor is more complicated and for this purpose it is separated in a dedicated driver called [`hid-nintendo`](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-nintendo.c).
For this driver to be loaded, the Bluetooth stack has to successfully discover the device HID service.

Bluetooth HID uses two L2CAP channels.
L2CAP is basically traffic manager that basically manages how data flows from higher application level to lower radio level.
L2CAP has a concept of Protocol/Service Multiplexer (PSM), which acts similarly to network ports used in TCP/UDP.
The first HID channel is called HID Control channel, having PSM number 0x0011, used for control-oriented communication, while the second HID channel is called HID Interrupt channel, having PSM number 0x0013, used for carrying most of the HID traffic.

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

It was clear that the fail was happening on steps 4 and 5, but it was unclear why.
To diagnose the problem, we need to check what the Linux Bluetooth stack (BlueZ) actually received.
For this purpose, we can use the [`btmon`](https://github.com/bluez/bluez/wiki/btmon) utility, which is basically Bluetooth monitor utility, storing the Bluetooth traffic as seen by the Linux stack.
Storing a Bluetooth stack capture is simply done with

```shell
sudo btmon -w capture.btsnoop
```

and later inspection is possible with

```shell
btmon -r capture.btsnoop
```

It is also possible to open `btsnoop` files with [Wireshark](https://www.wireshark.org/).

Instead of manually trying to read and parse the capture file, we can simply utilize LLM to help with that task.

After starting `btmon` capture session, I've put the controller in pairing mode, and used `bluetoothctl` to utilize BlueZ.
The Mac address of the controller is `A0:5A:5D:47:BF:83`, so I executed the following commands inside `bluetoothctl`:

```shell
remove A0:5A:5D:47:BF:83
scan bredr
pair A0:5A:5D:47:BF:83
trust A0:5A:5D:47:BF:83
connect A0:5A:5D:47:BF:83
```

After trying connect, the controller was immediately disconnecting, which is the issue we are trying to diagnose now.

After collecting the `steelplay.btsnoop` file, I used GPT-5.6 Sol (High effort) to inspect the file and find the issue.

There were 2 issues detected:

1. BlueZ was asking SDP for UUID 0x1200, which is PnP Information, but instead of getting PnP record, got the Nintendo HID record.
2. Even with the wrong HID record returned, there was visible SDP violation - missing bytes in the SDP response. The HID record has 384 bytes, but each SDP response is list of attribute lists. The bytes describing the outer list were missing.

To confirm the issues, we created a simple Python script that allowed us to easily send SDP requests for PnP and HID records, and the result was very interesting: the records were perfectly swapped.
PnP request returned HID record, while HID request returned PnP record.

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

Looking at these issues, it was looking promising that the first one would easily be patched on firmware level, but the second seemed a bit harder to patch.
Nevertheless, before patching, we would need a way to extract the firmware of the device first.

## Part 2: Extracting the firmware

We already found a way to put the controller in firmware update mode by holding HOME + X + Y buttons.
Once we put the controller in firmware update mode, checking USB devices, using tool such as `lsusb`, the controller was enumerated as:

```
BR23 UBOOT1.00
USB VID:PID 4c4a:2342
```

The BR23 identifier helped to find the actual chip used in the controller.
BR23 is internal identifier name for AC635N/AC695N series of chips developed by [JieLi Tech](https://doc.zh-jieli.com/vue/#/docs/ac63).
It has so called `piv32` architecture, that will be important once we need to get the binary tools from the toolchain.
Having this information, it was easy to find opensource tool that allowed interacting with the USB download mode (referred as UBOOT), called [`jl-uboot-tool`](https://github.com/kagaimiq/jl-uboot-tool).
The tool allows to download and upload firmware to BR23 chips when in UBOOT mode.

The tool is written in Python and easy to set up.
I've created virtual environment to run the tool, using the provided `jluboottool.py` script.
Ensure `sg` module is loaded on Linux (`modprobe sg`).

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

To dump the firmware, we need to provide specific addresses to store.
Using the provided JEDEC ID of the SPI NOR flash the tool reports, `0xeb6014`, we can see that the Flash size is 8 MBit (1 MiB), so we can dump the whole flash content to file by entering:

```shell
read 0 0x100000 steelplay-original-full.bin
```

After dumping the firmware, we need to find the structure of the firmware file that the BR23 chips are using.

## Part 3: Decoding the firmware file

If we try to inspect the originally dumped firmware, it seems that it is encrypted.
Simple strings command gives nothing understandable, suggesting that the firmware is encrypted.
This is another point where LLMs have proven to be very instrumental.
The LLM managed to find all required resources and provide code that allows to decrypt the firmware file.

This documentation comes from a community reverse-engineering project, [JieLi Misc Tools](https://github.com/kagaimiq/jl-misctools), more specifically the firmware unpacker file [`fwunpack_newfw.py`](https://github.com/kagaimiq/jl-misctools/blob/main/firmware/fwunpack_newfw.py).

It turns out the firmware is not truly AES encrypted, but it uses XOR stream cipher.
There is top-level metadata which uses the same cipher with fixed key 0xFFFF.
This metadata is basically lightweight flash file system (called JLFS), which organizes the components of the firmware, typically including names, offsets, sizes and attributes.
Beside generic info needed for the bootloader, it also includes the application firmware details (typically called `app.bin`), but also has file that contains the chip key (typically called `isd_config.ini`)
The application firmware uses a bit modified XOR stream cipher with Sequential Function Chart (SFC) block-key scheme.
Basically, the app firmware is processed in 32-bytes blocks and each block gets a derived initial key, using the chip key.
The chip key was visible when we executed the `jl-uboot-tool` script, in our case it was `0xA80F`.

Using this info, we are able to get the firmware in binary format, `steelplay-app.bin`.

## Part 4: Disassembly of the application firmware

The binary application firmware itself is hard to consume, so we need to generate disassembly listing from it.
As start runtime address, the one in the [AC63 SDK linker script](https://github.com/Jieli-Tech/fw-AC63_BT_SDK/blob/master/cpu/br23/sdk_ld.c) was used, `0x01E00120`.
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

where `--start-address` and `--stop-address` specify the range of CPU addresses that we want to disassemble.
If we omit them, then we disassemble the whole binary file.
With this, we can extract specific bytes from the binary application, decode them as PI32V2 instructions and display their addresses in the range `<START_ADDR>-<STOP_ADDR>`.

### Bug 1: Finding the PnP and HID arrays

To resolve the first bug, where SDP responded with HID array when asked for PnP information and vice-versa, we will try to find the actual PnP and HID arrays in the firmware.
We expect the arrays addresses are simply swapped in the function that prepares the SDP response arrays.
For this purpose, we run scan over `steelplay-app.bin` trying to find expected SDP response bytes that we collected with `btmon`.
We managed to find the matches in the decrypted application binary file, and we can follow the following calculations to get the address of the buffers (`app_offset = fw_offset + 0x30E0`):

|                        | HID          | PnP          |
| :--------------------- | :----------- | :---------   |
| app binary offset      | 0x20ACA      | 0x20591      |
| fw binary offset       | 0x23BAA      | 0x23671      |
| size (bytes)           | 0x0180 (384) | 0x008F (143) |

We expect to be a procedure in the code that matches calling function like this: `sdp_send_response(sdp_data, data_length)`.
With the help of the LLM, we can inspect the disassembly and find the expected procedure, as it may take some time to manually inspect the disassembly to find the procedure.
The reason is that the address is most probably indirectly specified, and we need to search using the size, which will return multiple occurrences.
The LLM managed to find the correct disassembly parts that we needed using the array size as a first search and then matching the array addresses in the surrounding code, which indeed were indirectly addressed.
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

So patching the first issue is quite easy, we just need to swap that `ptr` assignment inside the condition branches.
But before patching, we must fix the second issue too.

### Bug 2: wrapping the records with the outer sequence

We know that the second issue is not including the outer sequence header for the SDP response.
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

Instead, we wanted to get equivalent C code like the following for the selection:

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

The quickest and easiest way to fix this issue is to find place in the firmware where we can put the wrapped records.
We need total of 387 + 146 = 533 bytes of memory.
As the controller has multiple personalities, we can easily repurpose other SDP record for this purpose, as we are only interested in getting the Nintendo controller one working.
And interestingly, there was a record in the application firmware, which was with size 683 bytes (derived by inspecting the header bytes), so we chose that location to insert the wrapped records (address range `0x243C3..0x2466D`).
The whole neighbourhood was basically static SDP profile-data storage and no actual executable code, so there were multiple locations that we could chose for the wrapped records.

Once we had this plan in motion, it was quite trivial to patch the firmware code.

## Part 5: Patching the firmware

The patching of the decrypted firmware file was quite simple - byte replacement.
We simple replaced the addresses of the SDP records with our wrapped records.
Also, the application firmware part had CRCs that we needed to recompute so the firmware was still valid.
With this, we got the patched decrypted firmware.
Finally, we needed to use the same scheme that we used for decryption to encrypt the new firmware again.
We encrypted the modified header and application binary.

With this, we got the new patched firmware ready for testing on the controller.

## Part 6: Finding the final issue

The patched firmware could simply be flashed using the `jluboottool` when the controller is put in USB fw update mode.
After flashing the firmware, we proceeded with the usual pairing and connection process, but the controller was still not connecting.
We utilized `btmon` again and there was new issue found: the patch we applied was necessary, but not sufficient.
We saw that BlueZ performed the following queries and got the following responses:

```
1. Query UUID 0x0100: empty response
2. Query UUID 0x1200: PnP response
3. Query UUID 0x1002: empty resposne
```

There wasn't query for HID UUID `0x1124`, explaining why the device wasn't HID enumerated.

The first empty response was to UUID `0x0100`, designated to L2CAP protocol, the second was to `0x1002`, designated to `PublicBrowseRoot`.
Initially, the hypothesis was that the missing response was for the `PublicBrowseRoot`, which should return the SDP records for all publicly available services, in our case aggregate of HID and PnP records.
For this purpose, we created this aggregate in the firmware and created a new patched firmware file that returned this aggregate when there was query for UUID `0x1002`, but yet again the device wasn't HID enumerated.

With the help of the LLM, we inspected the BlueZ service search path, and it turns out the initial query to UUID `0x0100` is more important, as both of our services descriptors contained L2CAP.
So we needed to return the aggregate we created as response to UUID `0x0100`.
And indeed, after created the newly patched firmware, we could finally see the device HID enumerated and functioning great with the `hid_nintendo` driver.

All steps are provided in the following Python CLI, which expects the original encrypted firmware dump as input.

```python
#!/usr/bin/env python3
import argparse, hashlib, struct
from pathlib import Path
from collections import namedtuple

# Steelplay Adventurer / JieLi BR23 (AC63) firmware tool.
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
    ap=argparse.ArgumentParser(description="Steelplay Adventurer BR23 decrypt/patch/re-encrypt tool")
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

There were quite a lot of concepts needed to find the bug, which would require great deal of research, that would consume quite a lot of time.
From understanding Bluetooth service discovery process, collecting and analyzing Bluetooth traces, researching already existing tools and SDKs (`jl-uboot-tool` and AC63 SDK), reading and analyzing assembly instructions and general help when getting stuck, it is truly amazing how the knowledge around the internet can easily be accessed and utilized, but also helping one to learn new things.

## Conclusion

It is unfortunate that the controller was not working out of the box on PC as I wanted it to work.
Having the hardware unfunctional because of firmware issues is very frustrating.
Sadly, for products at this price range is typically not expected to have firmware fixes for use-case as mine, as the controller was not even intended for such use-case.

Nevertheless, it gave interesting side project that helped me learn new concepts and skills, which is very valuable to me.
It feels great when the controller is finally able to connect to my Linux gaming machine and it is possible to utilize all its functionalities.
