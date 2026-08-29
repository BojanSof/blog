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

# Exploring the controller

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

# Part 1: Diagnosing the problem

In Nintendo switch mode, the controller uses Bluetooth BR/EDR (Basic Rate / Enhanced Data Rate, also referred to as Bluetooth Classic), not Bluetooth Low Energy (BLE).
I will simply refer to the communication protocol as Bluetooth.

Initially the controller could pair, authenticate and encrypt successfully, but Linux did not end up with a usable Nintendo HID device.
Although pairing was successful, retrieving the controller capabilities using Service Discovery Protocol (SDP) was failing.

SDP is Bluetooth service, which can simply be thought as small database running on the Bluetooth device, and the PC sends queries to this database.
The SDP record contains attributes describing the service.
The controller is expected to have SDP records for Human Interface Device (HID) and Plug and Play (PnP) information, describing the manufacturer and product ID.
In our case, these records should match Nintendo Switch Pro Controller ones, as our controller is trying to emulate the Nintendo controller.

## HID service

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

```
sudo btmon -w capture.btsnoop
```

and later inspection is possible with

```
btmon -r capture.btsnoop
```

It is also possible to open `btsnoop` files with [Wireshark](https://www.wireshark.org/).

Instead of manually trying to read and parse the capture file, we can simply utilize LLM to help with that task.

After starting `btmon` capture session, I've put the controller in pairing mode, and used `bluetoothctl` to utilize BlueZ.
The Mac address of the controller is `A0:5A:5D:47:BF:83`, so I executed the following commands inside `bluetoothctl`:

```
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

{.file='sdp_matrix_inspect.py'}

Looking at these issues, it was looking promising that the first one would easily be patched on firmware level, but the second seemed a bit harder to patch.
Nevertheless, before patching, we would need a way to extract the firmware of the device first.

# Part 2: Extracting the firmware

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
# Output of sudo .venv/bin/jluboottool.py --chip br23

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

To dump the firmware, we need to provide specific addresses to store.
Using the provided JEDEC ID of the SPI NOR flash the tool reports, `0xeb6014`, we can see that the Flash size is 8 MBit (1 MiB), so we can dump the whole flash content to file by entering:

```
read 0 0x100000 steelplay-original-full.bin
```

After dumping the firmware, we need to find the structure of the firmware file that the BR23 chips are using.

# Part 3: Decoding the firmware file

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

# Part 4: Disassembly of the application firmware

The binary application firmware itself is hard to consume, so we need to generate disassembly listing from it.
As start runtime address, the one in the [AC63 SDK linker script](https://github.com/Jieli-Tech/fw-AC63_BT_SDK/blob/master/cpu/br23/sdk_ld.c) was used, `0x01E00120`.
The disassembly can be generated with `objdump` from the binary machine code:

```
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

## Bug 1 Inspection: Finding the PnP and HID arrays

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

## Bug 2 solution: wrapping the records with the outer sequence

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

Once we had this plan in motion, it was quite trivial to patch the firmware code - simple byte replacement.
