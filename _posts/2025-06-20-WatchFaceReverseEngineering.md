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
More info for one variant of this chip, JL7012F, can be found [yufanchip webpage](https://www.yufanchip.com/audio-bluetooth-chip-jl7012f.html), which seems like a component distributor company.
The image below shows the block diagram of JL7012F chip, extracted from the datasheet found on yfanchip.

![JL7012F Block Diagram](/assets/img/smawf/jl7012f-block-diagram.png)

> This blog post is purely for educational purposes, without intention to violate the terms of service of the smart watch. It would be great if the manufacturers provide watch face editing tools for such watch faces so the users can customize their devices to their likings.
{: .prompt-warning }

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

## Decoding the Format

To explore the format, I used hexeditor, to look at the specific bytes in the file, along with [ipython](https://ipython.org/), powerfull interactive shell, helping a lot with file operations and analyzing the content in code.
Python enables to quickly express ideas to perform on the content of the file or specific parts of it.

Initially, thanks to the forum threads described above, I had some good idea of what to expect in the watch face format.
Basically, the watch face file contains two things:
- Image resources, like background, digits, symbols, stored in some format, and
- Block information, which describe the actual layout of the watchface, which assets are used, where they are placed and similar.

The watch face file is interestingly engineered.
At the beginning, the file contains list of blocks information and list of the size of each image asset.
The lists can have different sizes in different watch faces, so every watch face starts with the size of the lists.

The following hex-view is from the `10011.bin` watch face file, and provides the most basic file structure.

<div class="hex-view" 
     data-src="{{site.baseurl}}/assets/files/smawf/10011.bin"
     data-width="16"
     data-toppct="90"
     data-maxlines="60"
     data-highlights='[
       {"start":0, "length":2, "color":"#dffc03", "label":"Images info list count"},
       {"start":2, "length":1, "color":"#0d9900", "label":"Block count"},
       {"start":3, "length":1, "color":"#6b6b6b", "label":"Unknown"},
       {"start":4, "length":320, "color":"#006699", "label":"List of blocks info"},
       {"start":324, "length":488, "color":"#99002e", "label":"List of images info"},
       {"start":812, "length":709992, "color":"#168876", "label":"List of images data"}
     ]'>
</div>

### Data Header

I called the first 4 bytes of the watch face file as Header.
The first two bytes represent the number of image assets in the watch face and the third byte is the number of blocks consisting the layout of the watch face.
I couldn't understand what the fourth byte means, and it wasn't important as long as I could tell.
Maybe it represents some kind of version.
It was having the value `0x02` for every watch face that I inspected.
For the `10011.bin` watch face, we can see that it has 122 (`0x007a`) image assets, and the number of blocks is 16 (`0x10`).

### Block info

Now let's take a closer look at the block info structure, by inspecting single instance of this structure.

<div class="hex-view" 
     data-src="{{site.baseurl}}/assets/files/smawf/10011.bin"
     data-start="4"
     data-end="24"
     data-width="4"
     data-toppct="90"
     data-maxlines="60"
     data-highlights='[
       {"start":4, "length":4, "color":"#1870c6", "label":"Image offset"},
       {"start":8, "length":2, "color":"#1c7aad", "label":"Image ID"},
       {"start":10, "length":2, "color":"#1cabbd", "label":"Width"},
       {"start":12, "length":2, "color":"#8b15e8", "label":"Height"},
       {"start":14, "length":2, "color":"#a6008a", "label":"X-axis position"},
       {"start":16, "length":2, "color":"#c13182", "label":"Y-axis position"},
       {"start":17, "length":1, "color":"#e46180", "label":"Number of images"},
       {"start":18, "length":1, "color":"#ff8f77", "label":"RGBA format"},
       {"start":19, "length":1, "color":"#82399a", "label":"Type"},
       {"start":20, "length":1, "color":"#bf72c7", "label":"Horizontal Alignment"},
       {"start":21, "length":1, "color":"#01ecaa", "label":"Compression type"},
       {"start":22, "length":1, "color":"#e3e23a", "label":"X-axis rotation center*"},
       {"start":23, "length":1, "color":"#feae5e", "label":"Y-axis rotation center*"}
     ]'>
</div>

The next image shows what these fields mean.

![Block layout](/assets/img/smawf/block-info.svg)

### Image size info

The image size info table is quite simple and contains list of 4-bytes values, each representing the size of a specific image resource in the watch face file.
It is good to note here that image data size is always divisble by 4, most probably because of the SoC expects the data to be aligned on word (32-bit) boundary in the Flash storage.
This will require some padding in the image data, but we will look at that later.

### Image data

After the "metadata", the watch face file contains the actual image resources data.
The pixel format used for storing the image data is RGB565 (requiring 2 bytes) or Alpha + RGB565 (requiring 1 + 2 = 3 bytes), depending on the `RGBA` info stored in the block info.

I've found two methods how image data is stored:
- uncompressed method, denoted by the value of `0x00` of the `compr` field in the block info structure, and
- line-based compression method, denoted by the value of `0x04` of the `compr` filed in the block info structure.

#### Uncompressed method

The uncompressed method, often used for storing image assets as the analog hands, stores all of the RGB565 or Alpha + RGB565 pixel values, without taking into consideration if there are repeating pixel values one after another.
Pixels are stored in line order - going from top to bottom.
Each line is padded with zeros to ensure its size is multiple of 4.

<!-- EXAMPLE UNCOMPRESSED IMAGE WITH HEX VIEW HERE -->

#### Compression method

The `0x04` compression method utilizes line-based [run-length encoding](https://en.wikipedia.org/wiki/Run-length_encoding) to compress image data.
What this basically means is that in each line, repeating pixel values are replaced with the number of pixels that are part of the chain, and the pixel value.

## Using Python to parse C-style structure data

We can perform the parsing of the C-style structured data easily in Python, utilizing the [`struct`](https://docs.python.org/3/library/struct.html) module and [`dataclasses`](https://docs.python.org/3/library/dataclasses.html) module.

The `dataclasses` module allows us to easily specify the fields of a class, opposed to the way of defining the fields in the `__init__` method.
On the other side, the `struct` module allows to easily describe data layout using format string.
The `struct` module is missing bit-fields handling, which often appears in C code, especially one targeting embedded systems, so we need to handle that manually.

> There is a Python package called [`bitstruct`](https://bitstruct.readthedocs.io/) that works on bit level opposed to the `struct` module in Python, which works on byte level. This package was not used in this project.
{: .prompt-tip }

Let's take the `BlockInfo` structure as an example and see how we can easily represent it in Python.

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
{: file='block_info.py'}

Using `dataclasses` module, we define each field of the block info structure.
We utilize the [`struct.Struct`](https://docs.python.org/3/library/struct.html#struct.Struct) class, creating `_struct` object, to provide the byte-level description of the block info structure, specifying the size of each field in number of bytes and the byte order.
We can now easily pack structured data in byte string by simply calling the [`_struct.pack`](https://docs.python.org/3/library/struct.html#struct.Struct.pack).
Similarly, if we have the byte string, we can simply call the [`_struct.unpack`](https://docs.python.org/3/library/struct.html#struct.Struct.unpack) function to extract the structured data.

For convenience, we can implement the `__bytes__` function, to be able to simply convert structured data to byte string, by calling the `bytes()` function on the `BlockInfo` object.
This function uses the `_struct.pack` function to provide the byte string for the object.

A lot of Python modules, like `json`, `yaml` and many others related to serialization, that provide `load()` function, for loading specific serialization file types in memory, provide `loads()` method, which allows to give string object (`str`, `bytes` or `bytearray`) as input.
Following this approach, we can implement static method, `loads()`, which allows to create object from input bytes.
This function utilizes the `_struct.unpack` function under the hood.

```terminal
> block_info_bytes = b"\x2c\x03\x00\x00\x00\x00\x04\x01\x3e\x01\x00\x00\x00\x00\x01\x01\x09\x04\x00\x00"
> block_info = BlockInfo.loads(block_info_bytes)
> block_info
BlockInfo(img_offset=812, img_id=0, width=260, height=318, pos_x=0, pos_y=0, num_imgs=1, is_rgba=False, blocktype=<BlockType.Preview: 1>, align=<BlockHorizontalAlignment.Left: 9>, compr=4, cent_x=0, cent_y=0)
> bytes(block_info) == block_info_bytes
True
```
{: file="Block Info Example"}

All functions for parsing, editing and creating watch face files are implemented in the [`smawf.py`](https://github.com/BojanSof/sma-wf-editor/blob/main/smawf.py) script.

```terminal
> from smawf import WatchFace
> wf_bytes = open("10011.bin", "rb").read()
> wf = WatchFace.loads(wf_bytes)
> wf.meta_data.blocks_info[0]
BlockInfo(img_offset=812, img_id=0, width=260, height=318, pos_x=0, pos_y=0, num_imgs=1, is_rgba=False, blocktype=<BlockType.Preview: 1>, align=<BlockHorizontalAlignment.Left: 9>, compr=4, cent_x=0, cent_y=0)
> wf.imgs_data[0].unpack()
<PIL.Image.Image image mode=RGB size=260x318>
> wf.imgs_data[0].unpack().show()  # opens image preview
```
{: file="smawf.py usage"}

## Watch Face Editor GUI

As final thing for this project, I've created graphical interface that allows to create and edit watch faces for the smart watch.

![SMA smart watch face creator](/assets/img/smawf/sma-wf-gui.png)

The GUI provides block info editor on the left side, with graphical preview and editor on the right side, which allows to move, scale and rotate the blocks.
It allows to easily load and save watch face files.
There are also tools to create preview of the watch face by utilizing the `Tools -> Create Preview` functionality, or save all image assets in a given folder, by using `Tools -> Save all images`.

## Conclusion

![Goal achieved](/assets/img/smawf/sma-wf-end-result.jpeg)
_The goal was achieved!_

Overall, this project was quite fun and allowed me to explore the clever engineering of the watch face format in a cheap smart watch.
Some of these devices have very good screens, long battery life, but it would be cool if they provided more customization support, like the Android smart watches.

Sadly, although this watch had very good screen and I really loved it, after one month, the battery stopped charging and was deemed as irreparable by the service company of the place where it was bought.
But it sure did provide me good fun during the month it was working!

<!-- Need to change this in future, for better re-use -->
<!-- For hexview, copied from /assets/styles/hexview.css -->
<style>
.hex-view {
  font-family: monospace;
  background: var(--hex-bg);
  color: var(--hex-fg);
  padding: 1em;
  overflow-x: auto;
  border: 1px solid var(--hex-border);
  margin-bottom: 1em;
  position: relative;
}

.hex-filename {
  position: absolute;
  top: 0.5em;
  left: 1em;
  font-weight: bold;
  font-family: monospace;
  font-size: 0.95em;
  color: var(--hex-fg);
}

.hex-line {
  white-space: nowrap;
}

.byte-span {
  display: inline-block;
  padding: 0.1em 0.4em;
  margin-right: 0.1em;
  border-radius: 4px;
  position: relative;
  pointer-events: auto;
}

.highlighted {
  background-color: #b3e5fc;
}

.tooltip {
  position: absolute;
  background: var(--tooltip-bg);
  color: var(--tooltip-fg);
  padding: 0.3em 0.5em;
  border-radius: 4px;
  font-size: 0.8em;
  white-space: nowrap;
  z-index: 9999;
  display: none;
  pointer-events: none;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  margin-top: 0.5em;
  font-size: 0.85em;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.4em;
}

.legend-color {
  width: 12px;
  height: 12px;
  display: inline-block;
  border: 1px solid #333;
}

html[data-theme='light'] .hex-view {
  --hex-bg: #f5f5f5;
  --hex-fg: #212121;
  --hex-border: #ccc;
  --tooltip-bg: #333;
  --tooltip-fg: #fff;
}

html[data-theme='dark'] .hex-view {
  --hex-bg: #1e1e1e;
  --hex-fg: #e0e0e0;
  --hex-border: #444;
  --tooltip-bg: #eee;
  --tooltip-fg: #111;
}
</style>

<!-- Need to change this in future, for better re-use -->
<!-- For hexview, copied from /assets/js/hexview.js -->
<script>
document.addEventListener("DOMContentLoaded", async () => {
  const views = document.querySelectorAll('.hex-view');
  for (const view of views) {
    const width = parseInt(view.dataset.width || '16');
    const maxLines = parseInt(view.dataset.maxlines || '50');
    const highlights = JSON.parse(view.dataset.highlights || '[]');
    const src = view.dataset.src;

    const response = await fetch(src);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (view.dataset.filename) {
      const filenameElem = document.createElement('div');
      filenameElem.className = 'hex-filename';
      filenameElem.textContent = view.dataset.filename;
      view.appendChild(filenameElem);
    }

    const legendMap = {};
    highlights.forEach(h => {
      if (h.label && !legendMap[h.label]) {
        legendMap[h.label] = h.color || '#b3e5fc';
      }
    });
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.style.position = 'relative';
    legend.style.display = 'flex'; // horizontal layout
    legend.style.flexDirection = 'row';
    legend.style.flexWrap = 'wrap';
    legend.style.alignItems = 'center';
    legend.style.marginBottom = '0.5em';
    legend.style.left = '0';
    legend.style.top = '0';
    legend.style.padding = '0.2em 0.7em';
    legend.style.borderRadius = '6px';
    legend.style.zIndex = '10';
    for (const label in legendMap) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.marginRight = '1.2em';
      item.innerHTML = `<span class=\"legend-color\" style=\"background:${legendMap[label]}\"></span> ${label}`;
      legend.appendChild(item);
    }
    view.insertBefore(legend, view.firstChild);

    const container = document.createElement('div');
    // Support data-start and data-end for bounds
    const start = parseInt(view.dataset.start || '0');
    const end = view.dataset.end ? parseInt(view.dataset.end) : bytes.length;
    const boundedBytes = bytes.slice(start, end);
    const boundedLength = boundedBytes.length;
    const lineCount = Math.ceil(boundedLength / width);
    const truncate = lineCount > maxLines;
    // Allow specifying top/bottom split percentage via data-toppct (default 50)
    const topPct = parseInt(view.dataset.toppct || '50');
    const bottomPct = 100 - topPct;
    const topLines = truncate ? Math.floor(maxLines * topPct / 100) : lineCount;
    const bottomStart = truncate ? lineCount - Math.floor(maxLines * bottomPct / 100) : lineCount;

    for (let i = 0; i < lineCount; ++i) {
      if (truncate && i === topLines) {
        const skipped = document.createElement('div');
        skipped.className = 'hex-line';
        skipped.textContent = '... skipped ...';
        container.appendChild(skipped);
        i = bottomStart - 1;
        continue;
      }

      const offset = i * width;
      const row = boundedBytes.slice(offset, offset + width);
      const lineElem = document.createElement('div');
      lineElem.className = 'hex-line';
      let html = '';

      // Add address column (relative to file, not just bounded region)
      html += `<span class="hex-address" style="display:inline-block; min-width: 4.5em; color: #888; margin-right: 1em;">${(start + offset).toString(16).padStart(8, '0')}</span>`;

      for (let j = 0; j < row.length; j++) {
        const idx = start + offset + j;
        const byteStr = row[j].toString(16).padStart(2, '0');
        const h = highlights.find(h => idx >= h.start && idx < h.start + h.length);
        const color = h?.color || 'var(--highlight-bg, #b3e5fc)';
        const label = h?.label || '';

        html += `<span class="byte-span ${h ? 'highlighted' : ''}" style="${h ? `background-color:${color}` : ''}" data-label="${label}">${byteStr}</span>`;
      }

      lineElem.innerHTML = html;
      container.appendChild(lineElem);
    }

    view.appendChild(container);
  }
});
</script>