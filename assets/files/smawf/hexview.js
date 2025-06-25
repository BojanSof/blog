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