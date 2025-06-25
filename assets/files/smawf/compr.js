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