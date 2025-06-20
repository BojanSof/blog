---
title: Reverse Engineering Smartwatch Watch Face format
date: 2025-06-20
categories: [Reverse Engineering, Smartwatch]
tags: [reverse engineering, smartwatch, python, watch face]
math: false
image:
  path: /assets/img/smawf/cover.webp
---

# Reverse Engineering Smartwatch Watch Face format

In this blog post, I am going to provide insights on the format used for storing watch faces in a cheap smart watch limited memory.
The cheap smart watches are basically an embedded system, that contain SoC which typically integrates all necessary functions for the smart watch, most notably:
- Bluetooth connectivity, including Bluetooth Standard and BLE (supporting LE Audio)
- Audio codecs and Audio DSP
- Graphics support, including 2D graphics accelerrators and display drivers
- Power management unit, which incorporates the battery charger
- Typically built-in Flash, used for storing firmware and watch faces

Typically, such SoCs are manufactured by Chinese companies.
One such chip is JL7012, manufactured by [JieLi Technology](https://www.zh-jieli.com/).
More info for one variant of this chip, JL7012F, can be found [yufanchip webpage](https://www.yufanchip.com/audio-bluetooth-chip-jl7012f.html), which seem like a component distributor company.
The image below shows the block diagram of JL7012F chip, extracted from the datasheet found on yfanchip.

![JL7012F Block Diagram](/assets/img/smawf/jl7012f-block-diagram.png)

## Brief story for the motive

I received the [Trevi T-Fit 400 C](https://www.trevi.it/catalog/articolo/146-smartwatch/yombjekdjj-t-fit-400-c-smart-fitness-band-curve-nero.html) smartwatch as a New Year’s gift, and it quickly became my favorite gadget.
The watch looks like one beatiful piece of hardware (with one major failiure, I will give more info later), featuring large 1.96" OLED display with very vivid colors.
It has touchscreen and also has rotary encoder and push button on the right side for interacting with it.
It provides the basic functionalities of typical smartwatches, including step count, heart rate, SpO2, stress measurement, sleep tracking, provides way of manually starting activites, and few more features, and some are more accurate and useful then others.

The watch is actually manufactured by a Chinese company, [SMA](https://www.smawatch.com/), and Trevi probably does white labeling of the products from SMA.
If we take a look at the [Product](https://www.smawatch.com/allWatch) page on SMA, we can see that the [AM10](https://www.smawatch.com/allWatch#:~:text=AM13-,AM10,-AM07) labelled watch looks very similar to the Trevi T-Fit 400 C.

The application running on the phone, used for connecting to the watch, syncing data from it and changing watch faces is SMART-TIME PRO, available on [Google PlayStore](https://play.google.com/store/apps/details?id=com.sma.smartv3.pro&hl=en&pli=1) and [Apple AppStore](https://apps.apple.com/us/app/smart-time-pro/id1494999335).

Now comes the part describind the motive for the project.
One of the default watch faces — a green digital clock with a cool radar animation — caught my eye.
But there was a catch: my favorite color is blue, and I really wanted to see that same watch face in blue.
This desire set me on a journey to figure out how to customize the watch face.

## Research: Cheap smart watches and watch face editors

The first and most reasonable thing to do is to check the Internet if someone already created a watch face editor for this watch.
Initial searches using the watch model were not providing results, so I started doing more generic searches, which included the keywords `cheap`, `chinese`, `smartwatch`, `watchface`, `format`.
I've started finding multiple posts on forums like [XDA Forums](https://xdaforums.com/) and [4PDA Forums](https://4pda.to/forum/index.php?act=idx), which provided some insights and tools (spreadsheets and applications typically without source code) for the watch face formats used in different cheap smart watches.

Most notably, the following threads from the User... helped me a lot, and I got in contact with him and he was very helpful an providing me insights even during the holidays period, when I wanted to get this project done.

Now, with bigger confidence, it was time to try and actually start decoding the watch face format.
But before that, I needed a way to extract watch face from the application.

## Step 1: Obtaining watch face file

The first thing that I got to do was obtaining the actual watch face file.
I discovered that the SmartTime PRO app stores watch face files in a cache directory on the Android device.
These files are in a binary format and have a specific filename pattern.  
*[Describe the filename pattern and location here]*

## Step 2: Decoding the Format with Python

To make sense of the binary format, I turned to Python. Using the `struct` module and `dataclasses`, I was able to map the raw bytes into structured data. Here’s a simplified example of how I defined a block of the watch face data:

```python
@dataclass
class BlockInfo:
    img_offset: int
    img_id: int
    width: int
    height: int
    pos_x: int
    pos_y: int
    num_imgs: int
    is_rgba: bool
    blocktype: BlockType
    align: BlockHorizontalAlignment
    compr: int
    cent_x: int
    cent_y: int
    _struct = struct.Struct("<IHHHHHBBBBBB")
    size = _struct.size

    def __bytes__(self):
        return self._struct.pack(
            self.img_offset,
            self.img_id,
            self.width,
            self.height,
            self.pos_x,
            self.pos_y,
            self.num_imgs,
            self.is_rgba << 7 | self.blocktype,
            self.align,
            self.compr,
            self.cent_y,
            self.cent_x,
        )

    @staticmethod
    def loads(data: bytes):
        assert len(data) == BlockInfo.size
        (
            img_addr,
            picidx,
            sx,
            sy,
            pos_x,
            pos_y,
            parts,
            blocktype,
            align,
            compr,
            cent_y,
            cent_x,
        ) = BlockInfo._struct.unpack(data)
        is_rgba = blocktype & 0x80 != 0
        blocktype = BlockType(blocktype & 0x7F)
        align = BlockHorizontalAlignment(align)
        return BlockInfo(
            img_addr,
            picidx,
            sx,
            sy,
            pos_x,
            pos_y,
            parts,
            is_rgba,
            blocktype,
            align,
            compr,
            cent_x,
            cent_y,
        )
```

This approach allowed me to read and write the binary data in a structured way, making it much easier to experiment and understand the format.

## Step 3: Discovering the Format

Through trial and error, and by comparing different watch face files, I gradually pieced together the structure of the format. Each block in the file describes an image or element on the watch face, including its position, size, and other properties. Some fields were straightforward, while others required more investigation and testing.

*[Describe your process of reverse engineering: what tools you used, how you compared files, any “aha!” moments, and how you validated your findings.]*

## Step 4: Building Tools for the Community

Once I understood the format, I created a Python script for decoding and encoding watch face files, as well as a GUI tool for creating and editing custom watch faces. These tools are open source and available on my GitHub repository:  
[https://github.com/BojanSof/sma-wf-editor](https://github.com/BojanSof/sma-wf-editor)

## Conclusion

Reverse engineering the watch face format was a fun and rewarding project. Not only did I get my blue-themed watch face, but I also learned a lot about binary formats, Python struct handling, and the smartwatch ecosystem. I hope my tools and findings help others customize their own devices!
