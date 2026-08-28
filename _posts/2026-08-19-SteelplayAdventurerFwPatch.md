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
With this, we can extract specific bytes from the binary application, decode them as PI32V2 instructions and display their addresses in the range `<START_ADDR>-<STOP_ADDR>`.
