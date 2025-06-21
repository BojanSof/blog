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

Initially, I found one thread on XDA called [HK89, HK26 smartwatch and maybe other watches made with JL7012 cpu](https://xdaforums.com/t/hk89-hk26-smartwatch-and-maybe-other-watches-made-with-jl7012-cpu.4616517/), which was very promising as the author already created two tools, one decomposer tool, which extracts the image resources and writes the necessary metadata from a given watch face file, and composer tool, that goes the other way around - creates watch face file from resources.
And the watch faces specified in that thread were using same chip as the one in my smart watch.
I've tried both tools and the decomposer worked somewhat for the 10011 watch face, but it wasn't functioning completely - there were few missing image resources.
It wasn't working well for other watch faces, the reason being there were specific block types that weren't implemented in the tool.
I couldn't get the composer tool to work with the watch face files that I was using.
Sadly, the tools were provided without source code, but produced outputs that helped during the reverse enginnering of the watch face format.

I carried on with the search through the forums and found few blog posts initiated by user called `vxsw`, who is creating a lot of tools for other smart watches and he is providing spreadsheets for the formats used in other smart watches.
The forum thread [[TBUI] TBUI Watch face tool. Editor for one of the FitcloudPro watch face format.](https://xdaforums.com/t/tbui-tbui-watch-face-tool-editor-for-one-of-the-fitcloudpro-watch-face-format.4591917/) really got my eye, and I was getting more knowledge from such posts about the formats of the watch faces used in such smart watches.

I've started to play around with the watch face format used in my smart watch a bit, but I got few things that were unclear to me and messaged `vxsw`, who was very helpful and provided me pointers and info that helped me during the process.
Big thanks to him!

So, with bigger confidence after the searching, I was ready to get my hands dirty.
But before that, I needed a way to extract watch face from the application.

## Obtaining watch face file

The first thing that I got to do was obtaining the actual watch face file.
I discovered that the SmartTime PRO app stores watch face files in a cache directory in application's data folder, which on Android is easy to access using `adb`.
The directory where the downloaded watch faces are stored, on my Android device is:
```
/storage/self/primary/Android/data/com.sma.smartv3.pro/cache/dial
```
{: file='Watch faces cache directory'}
For each watch face, there are two files:
- the actual watch face file, with `.bin` extension, and
- file with same name as the watch face file, but without extension.

Opening the file without extension in text editor showed that this file contains the link of the watch face preview image.

Interestingly, we can discover something about the naming conventions and we can download all the available watch faces for the smartwatch.
Let's take for example the watch face that was motive for the project, whose filename is `AM08_T-fit 400 C_10011.bin`.
The first part of the filename, `AM08_T-fit 400 C` is the model of the watch.
The same application is used for multiple smart watches.
The second part of the filename, `10011` is given based on the category of the watch face and the order of the watch face in the category list.
In this case, the category is `10000`, which represents animated watch faces, while `11` is the order of the watch face in the list.

Now let's take a look at the link in the file without extension:
```
https://api-oss.iot-solution.net/watchFace/JL/AM08/default/category/dynamic1/10011.gif
```
{: file='Watch face 10011 preview link'}

If we open the link, we are going to see the animated preview for the watch face:

![Watch Face 10011](/assets/img/smawf/10011.gif){: width="300" }

If we change 10011 to 10015, we get another watch face:

![Watch Face 10015](/assets/img/smawf/10015.gif){: width="300" }

The actual watch face can easily be downloaded if we only change the extension in the links to `.bin`.

Similarly, there are other categories besides the animated (aka `dynamic1` category), like sport ones (`exercies2`), business-looking watch faces (`business3`), analog watch faces (`machinery4`), and so on.
They follow the same naming conventions - instead of 10000 base for animated watch faces, change the base to 40000 and we can check the preview (now `png` format, as other watch faces are not having animations like the radar one on 10011) and download analog watch faces:
```
https://api-oss.iot-solution.net/watchFace/JL/AM08/default/category/machinery4/40001.png
https://api-oss.iot-solution.net/watchFace/JL/AM08/default/category/machinery4/40001.bin
```
{: file='Watch face 40001 preview and file links'}

![Watch face 40001 preview](/assets/img/smawf/40001.png){: width="300" }

> In the GitHub repository for the GUI that I made for this project, there is a [Python script](https://github.com/BojanSof/sma-wf-editor/blob/main/download_wfs_internet.py) that downloads all available watch faces for the smart watch.
{: .prompt-info }

We will work on the format decoding using the watch face that was motive for the project, 10011.

## Decoding the Format with Python

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
