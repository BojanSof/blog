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

To explain these fields, we will refer to few illustrations.
Some of the block fields are used only for specific block types.

![Block fields](/assets/img/smawf/block-info-light.svg){: .light}
![Block fields](/assets/img/smawf/block-info-dark.svg){: .dark}
_Basic block fields description_

Each block has type, described with the `blocktype` field, describing the functionality of the block.
There are quite few block types, including:
- Background,
- Animated decorations,
- Digital clock related ones (hours, minutes, seconds, AM/PM),
- Analog clock related ones (hours, minutes, seconds),
- Date related (year, month, date),
- Weather related,
- Data related (steps, heart-rate, distance, calories).

> The whole list of block types that I've discovered when I worked on the project are available on the [GitHub repository](https://github.com/BojanSof/sma-wf-editor/blob/40e55b183ecead0c1eb78b5ff288087c8262ee86/smawf.py#L19) for the project.
{: .prompt-info }

#### Assets-related fields

We will now explain the fields related to the image asset.

The `img_offset` field specifies the offset in the watch face file where the image assets can be found, for that specific block.
`imd_id` field is closely related and specifies the index for the [image info table](#image-size-info).
For a specific block, it is possible to have option to select one of total `num_imgs` assets.
For example, in case of digital clock, we can select up to 10 digits for the hours block.

The `is_rgba` field describes if the image asset is transparent (has alpha channel).
Actually, this field is combined with the `blocktype` field - `is_rgba` is the MSB.

We also have the `compr` field, which represents the compression method used to store the image asset.
We will cover the compression methods in the [image data](#image-data) section.

#### Layout-related fields

Now, let's take a look at the fields related to the layout of the watch face.

The origin of the coordinate system is at the top left corner, with the x-axis going towards right, y-axis going towards down, which is typical in computer graphics.
We have the `pos_x` and `pos_y` fields, which control the position of the block, more specifically the position of its top-left corner.
The `width` and `height` control the the size of the block.

The field called `align` describes the horizontal alignment of block that has multiple digits, like the digital time blocks and the data blocks - steps, calories, heart-rate.
It is possible to have left, center and right horizontal alignment.
The alignment is relative to the block position.
In left alignment, the digits start at same position as the block one, while in right alignment the digits end at same position as the block one.
In center alignment, the center of the digits is at the same position as the block one.

```
    |         block position
12345         right alignment
  12345       center alignment
    12345     left alignment
```
{: file='Horizontal alignment illustration'}

Finally, the two fields, `cent_x` and `cent_y` are related to specific block types that need to support rotation, like the analog time hands.
By trial and error, the rotation center has coordinates `(width - cent_x, height - cent_y)`, local to the block coordinate system.

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

#### Compression method

The `0x04` compression method utilizes line-based [run-length encoding](https://en.wikipedia.org/wiki/Run-length_encoding) to compress image data.
What this basically means is that in each line, repeating pixel values are replaced with the number of pixels that are part of the chain, and the pixel value.

The prefix used for the compression is actually consisting of 7-bit length field, denoted as `n`, and the MSB is a bit which we can refer to as `same_val`.
If `same_val` is zero, then after the prefix byte, we have the color values for `n` pixels.
If `same_val` is one, then after the prefix byte, we need to repeat the same color values for the next `n` pixels.
The color value for the pixel can be 2-bytes long for RGB or 3-bytes long for RGBA.

Below you can interactively explore how the smartwatch image compression works. Load your own image or use the sample, zoom and pan, and inspect the RLE segments visually:

<div id="compression-visualizer-blog">
  <style>
    :root {
      --cv-bg: #fff;
      --cv-fg: #222;
    }
    .cv-container {
      max-width: 900px;
      margin: 2em auto;
      padding: 2em;
      border-radius: 10px;
      box-shadow: 0 2px 8px #0001;
      background: var(--cv-bg) !important;
      color: var(--cv-fg) !important;
      transition: background 0.2s, color 0.2s;
      position: relative;
    }
    html[data-theme='light'] .cv-container {
      --cv-bg: #f5f5f5;
      --cv-fg: #212121;
    }
    html[data-theme='dark'] .cv-container {
      --cv-bg: #1e1e1e;
      --cv-fg: #e0e0e0;
    }
    body .cv-container {
      position: relative;
    }
    .cv-controls {
      margin-bottom: 1em;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.7em 1em;
    }
    .cv-controls .button-group {
      display: flex;
      gap: 0.5em;
      align-items: center;
    }
    .cv-controls .file-input-wrapper {
      position: relative;
      display: inline-block;
    }
    .cv-controls input[type="file"] {
      opacity: 0;
      width: 0.1px;
      height: 0.1px;
      position: absolute;
      z-index: -1;
    }
    .cv-controls .file-label {
      background: linear-gradient(90deg, #1976d2 0%, #42a5f5 100%);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0.5em 1.2em;
      font-size: 1em;
      font-weight: 500;
      box-shadow: 0 2px 6px #1976d220;
      cursor: pointer;
      transition: background 0.2s, box-shadow 0.2s, transform 0.1s;
      margin-right: 0.5em;
      display: inline-block;
    }
    .cv-controls .file-label:hover, .cv-controls .file-label:focus {
      background: linear-gradient(90deg, #1565c0 0%, #1976d2 100%);
      box-shadow: 0 4px 12px #1976d240;
      transform: translateY(-2px) scale(1.04);
    }
    .cv-controls input[type="number"] {
      border: 1.5px solid #1976d2;
      border-radius: 6px;
      padding: 0.4em 0.7em;
      font-size: 1em;
      width: 4em;
      outline: none;
      transition: border 0.2s, box-shadow 0.2s;
      box-shadow: 0 1px 3px #1976d210;
      background: var(--cv-bg);
      color: #1976d2;
      font-weight: 600;
    }
    .cv-controls input[type="number"]:focus {
      border: 2px solid #1565c0;
      box-shadow: 0 2px 8px #1976d220;
    }
    .cv-controls label {
      font-size: 1em;
      margin-right: 0.3em;
      color: #1976d2;
      font-weight: 500;
    }
    .cv-canvas-wrap { position: relative; border: 1px solid #ccc; background: var(--cv-bg); display: inline-block; }
    .cv-imgCanvas { image-rendering: pixelated; cursor: crosshair; }
    .cv-legend { margin-top: 1em; }
    .cv-legend span { display: inline-block; width: 1.5em; height: 1.5em; vertical-align: middle; margin-right: 0.5em; border-radius: 3px; }
    .cv-rle-same { background: #ffe0b2; border: 1px solid #ffb74d; }
    .cv-rle-diff { background: #bbdefb; border: 1px solid #1976d2; }
    .cv-tooltip {
      position: fixed;
      background: var(--cv-bg);
      color: var(--cv-fg);
      border: 1px solid #888;
      padding: 0.3em 0.7em;
      border-radius: 5px;
      font-size: 0.95em;
      pointer-events: none;
      z-index: 10;
      box-shadow: 0 2px 8px #0002;
      display: none;
      min-width: 180px;
    }
    .cv-note { font-size: 0.9em; color: #888; }
    .cv-drag-rect {
      position: absolute;
      border: 2px dashed #1976d2;
      background: rgba(25, 118, 210, 0.1);
      pointer-events: none;
      z-index: 20;
    }
    .cv-controls button {
      background: linear-gradient(90deg, #1976d2 0%, #42a5f5 100%);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0.5em 1.2em;
      font-size: 1em;
      font-weight: 500;
      box-shadow: 0 2px 6px #1976d220;
      cursor: pointer;
      transition: background 0.2s, box-shadow 0.2s, transform 0.1s;
      margin-right: 0.5em;
    }
    .cv-controls button:hover, .cv-controls button:focus {
      background: linear-gradient(90deg, #1565c0 0%, #1976d2 100%);
      box-shadow: 0 4px 12px #1976d240;
      transform: translateY(-2px) scale(1.04);
    }
    .cv-mode-label {
      display: inline-block;
      font-size: 1em;
      font-weight: 600;
      color: #1976d2;
      margin-left: 1em;
      letter-spacing: 0.03em;
    }
  </style>
  <div class="cv-container">
    <div class="cv-controls">
      <div class="button-group">
        <span class="file-input-wrapper">
          <input type="file" id="cv-imgInput" accept="image/*">
          <label for="cv-imgInput" class="file-label">Choose File</label>
        </span>
        <button id="cv-loadSample">Load Sample</button>
        <button id="cv-resetZoom">Reset Zoom</button>
      </div>
      <span id="cv-modeLabel" class="cv-mode-label">Image Mode: RGB</span>
      <div class="button-group">
        <label for="cv-lineSelect">Line:</label>
        <input type="number" id="cv-lineSelect" min="0" value="0">
        <button id="cv-showLine">Show Line</button>
        <button id="cv-showAll">Show All</button>
      </div>
      <span class="cv-note">Tip: Drag to zoom, double-click to reset.</span>
    </div>
    <div class="cv-canvas-wrap" style="position:relative;">
      <canvas id="cv-imgCanvas" width="256" height="256" class="cv-imgCanvas"></canvas>
      <div id="cv-tooltip" class="cv-tooltip"></div>
      <div id="cv-dragRect" class="cv-drag-rect" style="display:none"></div>
    </div>
    <div class="cv-legend">
      <span class="cv-rle-same"></span>RLE Same &nbsp;
      <span class="cv-rle-diff"></span>RLE Diff
    </div>
  </div>
  <script>
  (function(){
    let imgData = null, mode = 'rgb', scale = 16, offsetX = 0, offsetY = 0;
    let rleLines = [], showLineOnly = null;
    let dragStart = null, panStart = null, dragging = false;
    const canvas = document.getElementById('cv-imgCanvas');
    const ctx = canvas.getContext('2d');
    const tooltip = document.getElementById('cv-tooltip');
    const dragRectDiv = document.getElementById('cv-dragRect');
    const MAX_IMG_SIZE = 64;
    const CANVAS_SIZE = 512;
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    let minScale = 1, maxScale = 64;
    function rgb888_to_rgb565(r, g, b) {
      let val = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
      return [ (val >> 8) & 0xFF, val & 0xFF ];
    }
    function compressLine(pixels, is_rgba) {
      let b_per_val = is_rgba ? 3 : 2;
      let pix_vals = [];
      for (let i = 0; i < pixels.length; ++i) {
        if (is_rgba) {
          let [r,g,b,a] = pixels[i];
          let rgb565 = rgb888_to_rgb565(r,g,b);
          pix_vals.push([a, ...rgb565]);
        } else {
          let [r,g,b] = pixels[i];
          let rgb565 = rgb888_to_rgb565(r,g,b);
          pix_vals.push(rgb565);
        }
      }
      pix_vals = pix_vals.map(arr => arr.flat());
      let compressed = [];
      let count = 1, same_val = false, prev_val = pix_vals[0], segment_vals = prev_val.slice();
      for (let i_val = 1; i_val < pix_vals.length; ++i_val) {
        let val = pix_vals[i_val];
        let is_same = JSON.stringify(val) === JSON.stringify(prev_val);
        if (is_same) {
          if (!same_val) {
            if (i_val > 0) {
              segment_vals = segment_vals.slice(0, segment_vals.length - b_per_val);
              count -= 1;
              while (count > 0) {
                let subsegment_count = Math.min(0x7F, count);
                let subsegment_vals = segment_vals.slice(0, subsegment_count * b_per_val);
                let prefix = subsegment_count;
                compressed.push({type:'diff', prefix, vals: subsegment_vals.slice(), start:i_val-count, len:subsegment_count});
                segment_vals = segment_vals.slice(subsegment_count * b_per_val);
                count -= subsegment_count;
              }
              segment_vals = [];
            }
            count = 1;
            same_val = true;
          }
          count += 1;
        } else {
          if (same_val) {
            while (count > 0) {
              let subsegment_count = Math.min(0x7F, count);
              let prefix = 0x80 | subsegment_count;
              let pix_val = prev_val;
              compressed.push({type:'same', prefix, vals: pix_val.slice(), start:i_val-count, len:subsegment_count});
              count -= subsegment_count;
            }
            count = 1;
            same_val = false;
            segment_vals = [];
          } else {
            count += 1;
          }
          segment_vals = segment_vals.concat(val);
        }
        prev_val = val;
      }
      if (same_val) {
        while (count > 0) {
          let subsegment_count = Math.min(0x7F, count);
          let prefix = 0x80 | subsegment_count;
          compressed.push({type:'same', prefix, vals: prev_val.slice(), start:pixels.length-count, len:subsegment_count});
          count -= subsegment_count;
        }
      } else {
        while (count > 0) {
          let subsegment_count = Math.min(0x7F, count);
          let prefix = subsegment_count;
          let subsegment_vals = segment_vals.slice(0, subsegment_count * b_per_val);
          compressed.push({type:'diff', prefix, vals: subsegment_vals.slice(), start:pixels.length-count, len:subsegment_count});
          segment_vals = segment_vals.slice(subsegment_count * b_per_val);
          count -= subsegment_count;
        }
      }
      return compressed;
    }
    function fitToView() {
      if (!imgData) return;
      const width = imgData.width, height = imgData.height;
      scale = Math.max(1, Math.floor(Math.min(CANVAS_SIZE / width, CANVAS_SIZE / height)));
      minScale = 1;
      offsetX = 0;
      offsetY = 0;
      clampPan();
    }
    function clampPan() {
      if (!imgData) return;
      const width = imgData.width, height = imgData.height;
      const viewW = Math.floor(CANVAS_SIZE / scale);
      const viewH = Math.floor(CANVAS_SIZE / scale);
      offsetX = Math.max(0, Math.min(offsetX, width - viewW));
      offsetY = Math.max(0, Math.min(offsetY, height - viewH));
    }
    function drawImageAndOverlay() {
      if (!imgData) return;
      const width = imgData.width, height = imgData.height;
      // Clear canvas with theme background
      let bg = getComputedStyle(document.documentElement).getPropertyValue('--cv-bg') || '#fff';
      ctx.save();
      ctx.setTransform(1,0,0,1,0,0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = bg.trim();
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.restore();
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      // Compute visible region in image coordinates
      const viewW = Math.floor(CANVAS_SIZE / scale);
      const viewH = Math.floor(CANVAS_SIZE / scale);
      const sx = Math.floor(offsetX);
      const sy = Math.floor(offsetY);
      // Create a temp canvas for the visible region
      let tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = width;
      tmpCanvas.height = height;
      let tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.putImageData(imgData, 0, 0);
      // Draw the visible region, pixelated, never downscale
      ctx.drawImage(tmpCanvas, sx, sy, viewW, viewH, 0, 0, viewW*scale, viewH*scale);
      // Draw overlays
      for (let y = sy; y < sy + viewH; ++y) {
        if (y < 0 || y >= height) continue;
        if (showLineOnly !== null && y !== showLineOnly) continue;
        let rle = rleLines[y];
        let x = 0;
        for (let seg of rle) {
          let segStart = x;
          let segEnd = x + seg.len;
          // Only draw if segment is in view
          if (segEnd > sx && segStart < sx + viewW) {
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = seg.type === 'same' ? '#ff9800' : '#1976d2';
            ctx.lineWidth = 2;
            ctx.fillStyle = seg.type === 'same' ? '#ffe0b2' : '#bbdefb';
            let drawX = (Math.max(segStart, sx) - sx) * scale;
            let drawY = (y - sy) * scale;
            let drawW = (Math.min(segEnd, sx+viewW) - Math.max(segStart, sx)) * scale;
            ctx.fillRect(drawX, drawY, drawW, scale);
            ctx.strokeRect(drawX, drawY, drawW, scale);
            ctx.restore();
            seg._canvasRect = [drawX, drawY, drawW, scale, y, segStart];
          }
          x += seg.len;
        }
      }
      ctx.restore();
    }
    function getMouseSegment(mx, my) {
      if (!imgData) return null;
      const width = imgData.width, height = imgData.height;
      // Map mouse to image coordinates
      const viewW = Math.floor(CANVAS_SIZE / scale);
      const viewH = Math.floor(CANVAS_SIZE / scale);
      const sx = Math.floor(offsetX);
      const sy = Math.floor(offsetY);
      let x = Math.floor(mx / scale) + sx;
      let y = Math.floor(my / scale) + sy;
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      let rle = rleLines[y];
      let acc = 0;
      for (let seg of rle) {
        if (x >= acc && x < acc + seg.len) return {...seg, y, x:acc};
        acc += seg.len;
      }
      return null;
    }
    canvas.addEventListener('mousemove', e => {
      let rect = canvas.getBoundingClientRect();
      let mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let seg = getMouseSegment(mx, my);
      if (seg) {
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 10) + 'px';
        tooltip.style.top = (e.clientY + 10) + 'px';
        tooltip.innerHTML = `
          <b>Line ${seg.y}, X ${seg.x}</b><br>
          Type: <span class="cv-rle-${seg.type}">${seg.type.toUpperCase()}</span><br>
          Length: ${seg.len}<br>
          Prefix: 0x${seg.prefix.toString(16)}<br>
          Bytes: ${seg.vals.map(b=>b.toString(16).padStart(2,'0')).join(' ')}
        `;
      } else {
        tooltip.style.display = 'none';
      }
    });
    canvas.addEventListener('mouseleave', ()=>{ tooltip.style.display='none'; });
    canvas.addEventListener('mousedown', function(e) {
      let rect = canvas.getBoundingClientRect();
      dragStart = {x: e.clientX - rect.left, y: e.clientY - rect.top};
      panStart = {x: offsetX, y: offsetY};
      dragging = true;
    });
    canvas.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      let rect = canvas.getBoundingClientRect();
      let dx = Math.round((e.clientX - rect.left - dragStart.x) / scale);
      let dy = Math.round((e.clientY - rect.top - dragStart.y) / scale);
      offsetX = panStart.x - dx;
      offsetY = panStart.y - dy;
      clampPan();
      drawImageAndOverlay();
    });
    canvas.addEventListener('mouseup', function(e) {
      dragging = false;
    });
    canvas.addEventListener('wheel', function(e) {
      if (!imgData) return;
      e.preventDefault();
      let rect = canvas.getBoundingClientRect();
      let mx = e.clientX - rect.left;
      let my = e.clientY - rect.top;
      let wx = Math.floor(offsetX + mx / scale);
      let wy = Math.floor(offsetY + my / scale);
      let prevScale = scale;
      if (e.deltaY < 0) {
        scale = Math.min(scale * 2, maxScale);
      } else {
        scale = Math.max(Math.floor(scale / 2), minScale);
      }
      // Keep the mouse position fixed relative to the image
      offsetX = wx - Math.floor(mx / scale);
      offsetY = wy - Math.floor(my / scale);
      clampPan();
      drawImageAndOverlay();
    }, { passive: false });
    canvas.addEventListener('dblclick', function() {
      fitToView();
      drawImageAndOverlay();
    });
    function detectImageMode(imgData) {
      // Returns 'rgba' if any pixel has alpha != 255, else 'rgb'
      let d = imgData.data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] !== 255) return 'rgba';
      }
      return 'rgb';
    }
    function processImage() {
      if (!imgData) return;
      mode = detectImageMode(imgData);
      document.getElementById('cv-modeLabel').textContent = `Image Mode: ${mode.toUpperCase()}`;
      let width = imgData.width, height = imgData.height;
      let is_rgba = (mode === 'rgba');
      rleLines = [];
      for (let y = 0; y < height; ++y) {
        let row = [];
        for (let x = 0; x < width; ++x) {
          let idx = (y*width + x) * 4;
          let r = imgData.data[idx], g = imgData.data[idx+1], b = imgData.data[idx+2], a = imgData.data[idx+3];
          row.push(is_rgba ? [r,g,b,a] : [r,g,b]);
        }
        rleLines.push(compressLine(row, is_rgba));
      }
      drawImageAndOverlay();
    }
    function loadImageFromFile(file) {
      let reader = new FileReader();
      reader.onload = function(e) {
        let imgEl = new window.Image();
        imgEl.onload = function() {
          // Downscale if too large
          let scaleDown = Math.max(imgEl.width, imgEl.height) > MAX_IMG_SIZE
            ? MAX_IMG_SIZE / Math.max(imgEl.width, imgEl.height)
            : 1;
          let w = Math.max(1, Math.round(imgEl.width * scaleDown));
          let h = Math.max(1, Math.round(imgEl.height * scaleDown));
          let tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = w;
          tmpCanvas.height = h;
          let tmpCtx = tmpCanvas.getContext('2d');
          tmpCtx.drawImage(imgEl, 0, 0, w, h);
          imgData = tmpCtx.getImageData(0, 0, w, h);
          document.getElementById('cv-lineSelect').max = h-1;
          showLineOnly = null;
          offsetX = 0; offsetY = 0; scale = 16;
          processImage();
        };
        imgEl.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
    document.getElementById('cv-imgInput').addEventListener('change', function(e){
      if (e.target.files && e.target.files[0]) {
        loadImageFromFile(e.target.files[0]);
      }
    });
    document.getElementById('cv-resetZoom').addEventListener('click', function() {
      fitToView();
      drawImageAndOverlay();
    });
    document.getElementById('cv-showLine').addEventListener('click', function() {
      let line = parseInt(document.getElementById('cv-lineSelect').value);
      showLineOnly = isNaN(line) ? null : line;
      drawImageAndOverlay();
    });
    document.getElementById('cv-showAll').addEventListener('click', function() {
      showLineOnly = null;
      drawImageAndOverlay();
    });
    document.getElementById('cv-loadSample').addEventListener('click', function() {
      // 32x32: checkerboard + blue circle + red diagonal
      let w = 32, h = 32;
      let tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = w; tmpCanvas.height = h;
      let tmpCtx = tmpCanvas.getContext('2d');
      // Draw checkerboard
      for (let y = 0; y < h; ++y) for (let x = 0; x < w; ++x) {
        let c = ((x >> 3) & 1) ^ ((y >> 3) & 1) ? '#e0e0e0' : '#ffffff';
        tmpCtx.fillStyle = c;
        tmpCtx.fillRect(x, y, 1, 1);
      }
      // Draw blue circle
      tmpCtx.beginPath();
      tmpCtx.arc(w/2, h/2, 11, 0, 2 * Math.PI);
      tmpCtx.closePath();
      tmpCtx.fillStyle = 'rgba(33, 150, 243, 0.85)';
      tmpCtx.fill();
      // Draw red diagonal
      tmpCtx.strokeStyle = 'rgba(220, 44, 44, 0.95)';
      tmpCtx.lineWidth = 2.2;
      tmpCtx.beginPath();
      tmpCtx.moveTo(2, 2);
      tmpCtx.lineTo(w-3, h-3);
      tmpCtx.stroke();
      imgData = tmpCtx.getImageData(0, 0, w, h);
      document.getElementById('cv-lineSelect').max = h-1;
      showLineOnly = null;
      offsetX = 0; offsetY = 0; scale = 16;
      processImage();
    });
    // Load sample on first load
    document.getElementById('cv-loadSample').click();
  })();
  </script>
</div>

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
But it sure did provide me good fun during the Holiday season while it was working!

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