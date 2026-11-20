const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const dropZone = document.getElementById('dropZone');
const pageBar = document.getElementById('pageBar');
const cropModeBtn = document.getElementById('cropModeBtn');
const canvasContainer = document.getElementById('canvasContainer');
const workspace = document.getElementById('workspace');
const uploadBtn = document.getElementById('uploadBtn');
const uploadInput = document.getElementById('uploadInput');

const panModeBtn = document.getElementById('panModeBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomFitBtn = document.getElementById('zoomFitBtn');
const zoomPercentText = document.getElementById('zoomPercent');

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
}

let pdfDoc = null;
let totalPages = 1;
let currentPage = 1;
let pageEditedImages = {};
let pageHistories = {};

let isCropMode = false;
let isPanMode = false;
let spacePressed = false;
let isDrawing = false;
let isPanning = false;
let startX = 0, startY = 0;
let panStartX = 0, panStartY = 0;
let scrollLeftStart = 0, scrollTopStart = 0;
let snapshotBeforeDrag = null;

let scale = 1.0;
const scaleStep = 0.15;
const minScale = 0.15;
const maxScale = 5.0;

// 1. 綁定上傳按鈕與虛線框點擊（確保任何方式都能開啟檔案）
if (uploadBtn && uploadInput) {
  uploadBtn.addEventListener('click', () => uploadInput.click());
  if (dropZone) {
    dropZone.addEventListener('click', () => uploadInput.click());
  }
  uploadInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
      e.target.value = ''; // 允許重複選取同一檔案
    }
  });
}

// 2. 支援拖曳檔案進入工作區
if (workspace) {
  workspace.addEventListener('dragover', (e) => { e.preventDefault(); });
  workspace.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
}

// 3. 支援 Ctrl + V 直接貼上剪貼簿截圖
window.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const blob = items[i].getAsFile();
      const reader = new FileReader();
      reader.onload = (event) => loadSingleImage(event.target.result);
      reader.readAsDataURL(blob);
      break;
    }
  }
});

// 4. 載入從網頁擷取過來的畫面
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['capturedImage'], (result) => {
    if (result && result.capturedImage) {
      loadSingleImage(result.capturedImage);
    }
  });
}

function isCanvasVisible() {
  return canvasContainer && canvasContainer.style.display !== 'none';
}

// 切換裁切模式
if (cropModeBtn) {
  cropModeBtn.addEventListener('click', () => {
    if (!isCanvasVisible()) return;
    setCropMode(!isCropMode);
  });
}

function setCropMode(active) {
  isCropMode = active;
  if (!cropModeBtn) return;
  if (isCropMode) {
    setPanMode(false);
    cropModeBtn.classList.add('active');
    cropModeBtn.textContent = '✂️ 請框出保留區（點此取消）';
  } else {
    cropModeBtn.classList.remove('active');
    cropModeBtn.textContent = '✂️ 裁切畫面';
  }
}

// 切換手掌移動模式
if (panModeBtn) {
  panModeBtn.addEventListener('click', () => {
    if (!isCanvasVisible()) return;
    setPanMode(!isPanMode);
  });
}

function setPanMode(active) {
  isPanMode = active;
  if (panModeBtn) {
    panModeBtn.classList.toggle('active', isPanMode);
  }
  if (workspace) workspace.style.cursor = isPanMode ? 'grab' : 'auto';
  if (canvas) canvas.style.cursor = isPanMode ? 'grab' : 'crosshair';
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !spacePressed && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    spacePressed = true;
    if (workspace) workspace.style.cursor = 'grab';
    if (canvas) canvas.style.cursor = 'grab';
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spacePressed = false;
    if (!isPanMode) {
      if (workspace) workspace.style.cursor = 'auto';
      if (canvas) canvas.style.cursor = 'crosshair';
    }
  }
});

// 縮放控制
if (zoomInBtn) zoomInBtn.addEventListener('click', () => adjustZoom(scaleStep));
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => adjustZoom(-scaleStep));
if (zoomFitBtn) zoomFitBtn.addEventListener('click', () => fitToViewport());

if (workspace) {
  workspace.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      adjustZoom(e.deltaY < 0 ? scaleStep : -scaleStep);
    }
  }, { passive: false });
}

function adjustZoom(delta) {
  if (!isCanvasVisible()) return;
  const newScale = Math.max(minScale, Math.min(maxScale, scale + delta));
  applyZoom(newScale);
}

function applyZoom(newScale) {
  scale = newScale;
  canvas.style.transform = `scale(${scale})`;
  if (zoomPercentText) {
    zoomPercentText.textContent = `${Math.round(scale * 100)}%`;
  }
  canvasContainer.style.width = `${Math.round(canvas.width * scale)}px`;
  canvasContainer.style.height = `${Math.round(canvas.height * scale)}px`;
}

function fitToViewport() {
  if (!isCanvasVisible() || canvas.width === 0 || canvas.height === 0) return;
  const viewW = Math.max(300, (workspace.clientWidth || window.innerWidth) - 40);
  const viewH = Math.max(300, (workspace.clientHeight || window.innerHeight - 80) - 40);
  const scaleX = viewW / canvas.width;
  const scaleY = viewH / canvas.height;
  let fitScale = Math.min(scaleX, scaleY);
  if (fitScale > 1.0) fitScale = 1.0;
  applyZoom(fitScale);
}

function handleFile(file) {
  setCropMode(false);
  setPanMode(false);
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    loadPdfFile(file);
  } else if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (event) => loadSingleImage(event.target.result);
    reader.readAsDataURL(file);
  } else {
    alert("請選擇 PDF 或圖片檔（PNG / JPG）！");
  }
}

function showCanvas() {
  if (dropZone) dropZone.style.display = 'none';
  if (canvasContainer) canvasContainer.style.display = 'block';
}

function loadSingleImage(src) {
  setCropMode(false);
  setPanMode(false);
  pdfDoc = null;
  totalPages = 1;
  currentPage = 1;
  pageEditedImages = {};
  pageHistories = {};
  if (pageBar) pageBar.style.display = 'none';

  const img = new Image();
  img.onload = () => {
    showCanvas();
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const initialData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    pageEditedImages[1] = initialData;
    pageHistories[1] = [initialData];
    fitToViewport();
  };
  img.onerror = () => {
    alert("圖片讀取失敗，請確認檔案是否正常！");
  };
  img.src = src;
}

async function loadPdfFile(file) {
  if (typeof pdfjsLib === 'undefined') {
    alert("找不到 pdf.min.js！請確認 MaskApp 資料夾內有 pdf.min.js 與 pdf.worker.min.js。");
    return;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    totalPages = pdfDoc.numPages;
    currentPage = 1;
    pageEditedImages = {};
    pageHistories = {};

    if (pageBar) pageBar.style.display = totalPages > 1 ? 'flex' : 'none';
    showCanvas();
    await renderPdfPage(1);
  } catch (err) {
    alert("PDF 開啟失敗（可能是加密 PDF 或檔案損毀）：" + err.message);
  }
}

async function renderPdfPage(pageNum) {
  setCropMode(false);
  setPanMode(false);
  currentPage = pageNum;
  document.getElementById('pageIndicator').textContent = `第 ${currentPage} / ${totalPages} 頁`;
  document.getElementById('prevPageBtn').disabled = (currentPage <= 1);
  document.getElementById('nextPageBtn').disabled = (currentPage >= totalPages);

  if (pageEditedImages[pageNum]) {
    const saved = pageEditedImages[pageNum];
    canvas.width = saved.width;
    canvas.height = saved.height;
    ctx.putImageData(saved, 0, 0);
    fitToViewport();
    return;
  }

  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.0 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
  const initialData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  pageEditedImages[pageNum] = initialData;
  pageHistories[pageNum] = [initialData];
  fitToViewport();
}

document.getElementById('prevPageBtn').addEventListener('click', () => {
  if (currentPage > 1) renderPdfPage(currentPage - 1);
});
document.getElementById('nextPageBtn').addEventListener('click', () => {
  if (currentPage < totalPages) renderPdfPage(currentPage + 1);
});

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / scale,
    y: (e.clientY - rect.top) / scale
  };
}

canvasContainer.addEventListener('mousedown', (e) => {
  if (isPanMode || spacePressed) {
    isPanning = true;
    workspace.style.cursor = 'grabbing';
    canvas.style.cursor = 'grabbing';
    panStartX = e.clientX;
    panStartY = e.clientY;
    scrollLeftStart = workspace.scrollLeft;
    scrollTopStart = workspace.scrollTop;
    e.preventDefault();
    return;
  }

  const pos = getCanvasCoords(e);
  startX = pos.x;
  startY = pos.y;
  isDrawing = true;
  snapshotBeforeDrag = ctx.getImageData(0, 0, canvas.width, canvas.height);
});

workspace.addEventListener('mousemove', (e) => {
  if (isPanning) {
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    workspace.scrollLeft = scrollLeftStart - dx;
    workspace.scrollTop = scrollTopStart - dy;
    return;
  }

  if (!isDrawing) return;
  const pos = getCanvasCoords(e);
  ctx.putImageData(snapshotBeforeDrag, 0, 0);

  if (isCropMode) {
    const rx = Math.min(startX, pos.x);
    const ry = Math.min(startY, pos.y);
    const rw = Math.abs(pos.x - startX);
    const rh = Math.abs(pos.y - startY);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (rw > 0 && rh > 0) {
      ctx.putImageData(snapshotBeforeDrag, 0, 0, rx, ry, rw, rh);
      ctx.strokeStyle = '#ffeb3b';
      ctx.lineWidth = 3 / scale;
      ctx.setLineDash([8 / scale, 4 / scale]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
    return;
  }

  const shape = document.getElementById('shapeMode').value;
  ctx.strokeStyle = '#ff3d00';
  ctx.lineWidth = 3 / scale;
  ctx.setLineDash([8 / scale, 5 / scale]);

  if (shape === 'circle') {
    const cx = (startX + pos.x) / 2;
    const cy = (startY + pos.y) / 2;
    const rx = Math.abs(pos.x - startX) / 2;
    const ry = Math.abs(pos.y - startY) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
  }
  ctx.setLineDash([]);
});

window.addEventListener('mouseup', (e) => {
  if (isPanning) {
    isPanning = false;
    workspace.style.cursor = (isPanMode || spacePressed) ? 'grab' : 'auto';
    canvas.style.cursor = (isPanMode || spacePressed) ? 'grab' : 'crosshair';
    return;
  }

  if (!isDrawing) return;
  isDrawing = false;
  ctx.putImageData(snapshotBeforeDrag, 0, 0);

  const pos = getCanvasCoords(e);
  const rawX = Math.min(startX, pos.x);
  const rawY = Math.min(startY, pos.y);
  const rawW = Math.abs(pos.x - startX);
  const rawH = Math.abs(pos.y - startY);

  const x = Math.max(0, Math.floor(rawX));
  const y = Math.max(0, Math.floor(rawY));
  const w = Math.min(canvas.width - x, Math.floor(rawW));
  const h = Math.min(canvas.height - y, Math.floor(rawH));

  if (w < 6 || h < 6) return;

  if (isCropMode) {
    const croppedData = ctx.getImageData(x, y, w, h);
    canvas.width = w;
    canvas.height = h;
    ctx.putImageData(croppedData, 0, 0);

    pageEditedImages[currentPage] = croppedData;
    if (!pageHistories[currentPage]) pageHistories[currentPage] = [];
    pageHistories[currentPage].push(croppedData);

    setCropMode(false);
    fitToViewport();
    return;
  }

  applyEffect(x, y, w, h);

  const updatedData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  pageEditedImages[currentPage] = updatedData;
  if (!pageHistories[currentPage]) pageHistories[currentPage] = [];
  pageHistories[currentPage].push(updatedData);
});

function applyEffect(x, y, w, h) {
  const mode = document.getElementById('toolMode').value;
  const shape = document.getElementById('shapeMode').value;

  ctx.save();

  if (shape === 'circle') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
  }

  if (mode === 'mosaic') {
    const blockSize = Math.max(12, Math.floor(Math.min(w, h) / 2.2));
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    const smallW = Math.max(1, Math.floor(w / blockSize));
    const smallH = Math.max(1, Math.floor(h / blockSize));
    tempCanvas.width = smallW;
    tempCanvas.height = smallH;

    tempCtx.drawImage(canvas, x, y, w, h, 0, 0, smallW, smallH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, smallW, smallH, x, y, w, h);
    ctx.imageSmoothingEnabled = true;

  } else if (mode === 'blur') {
    const pad = Math.min(40, Math.floor(Math.min(w, h) * 0.3));
    const sx = Math.max(0, x - pad);
    const sy = Math.max(0, y - pad);
    const sw = Math.min(canvas.width - sx, w + pad * 2);
    const sh = Math.min(canvas.height - sy, h + pad * 2);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sw;
    tempCanvas.height = sh;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.filter = 'blur(22px)';
    tempCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    ctx.drawImage(tempCanvas, x - sx, y - sy, w, h, x, y, w, h);

  } else if (mode === 'circle' || mode === 'star') {
    const sampleX = Math.min(canvas.width - 1, Math.floor(x + w / 2));
    const sampleY = Math.min(canvas.height - 1, Math.floor(y + 3));
    const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    ctx.fillStyle = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
    ctx.fillRect(x, y, w, h);

    const char = mode === 'circle' ? 'O' : '*';
    const fontSize = Math.max(12, Math.floor(h * 0.65));
    ctx.font = `bold ${fontSize}px "Microsoft JhengHei", sans-serif`;
    ctx.fillStyle = '#333333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const count = Math.max(2, Math.floor(w / (fontSize * 0.75)));
    const maskText = char.repeat(count);
    ctx.fillText(maskText, x + w / 2, y + h / 2);
  }

  ctx.restore();
}

document.getElementById('undoBtn').addEventListener('click', () => {
  const hist = pageHistories[currentPage];
  if (hist && hist.length > 1) {
    hist.pop();
    const prevData = hist[hist.length - 1];
    canvas.width = prevData.width;
    canvas.height = prevData.height;
    ctx.putImageData(prevData, 0, 0);
    pageEditedImages[currentPage] = prevData;
    applyZoom(scale);
  }
});

document.getElementById('downloadPngBtn').addEventListener('click', () => {
  if (!isCanvasVisible()) return;
  const link = document.createElement('a');
  link.download = `個資已遮蔽_第${currentPage}頁_${new Date().getTime()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

document.getElementById('downloadPdfBtn').addEventListener('click', async () => {
  if (!isCanvasVisible()) return;

  const btn = document.getElementById('downloadPdfBtn');
  const originalText = btn.textContent;
  btn.textContent = "⏳ 正在封裝安全 PDF...";
  btn.disabled = true;

  try {
    const pageJpegs = [];
    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d');

    for (let p = 1; p <= totalPages; p++) {
      if (pageEditedImages[p]) {
        const imgData = pageEditedImages[p];
        offCanvas.width = imgData.width;
        offCanvas.height = imgData.height;
        offCtx.putImageData(imgData, 0, 0);
      } else if (pdfDoc) {
        const page = await pdfDoc.getPage(p);
        const viewport = page.getViewport({ scale: 2.0 });
        offCanvas.width = viewport.width;
        offCanvas.height = viewport.height;
        await page.render({ canvasContext: offCtx, viewport: viewport }).promise;
      }

      const jpegDataUrl = offCanvas.toDataURL('image/jpeg', 0.90);
      const binaryString = atob(jpegDataUrl.split(',')[1]);
      const imgBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        imgBytes[i] = binaryString.charCodeAt(i);
      }
      pageJpegs.push({ w: offCanvas.width, h: offCanvas.height, bytes: imgBytes });
    }

    const encoder = new TextEncoder();
    const chunks = [];
    let currentOffset = 0;
    const offsets = {};

    const addText = (str) => {
      const b = encoder.encode(str);
      chunks.push(b);
      currentOffset += b.length;
    };
    const addBytes = (b) => {
      chunks.push(b);
      currentOffset += b.length;
    };

    addText("%PDF-1.3\n");

    offsets[1] = currentOffset;
    addText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    const kids = pageJpegs.map((_, idx) => `${3 + idx * 3} 0 R`).join(" ");
    offsets[2] = currentOffset;
    addText(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageJpegs.length} >>\nendobj\n`);

    pageJpegs.forEach((pg, idx) => {
      const pageObjId = 3 + idx * 3;
      const imgObjId = 4 + idx * 3;
      const contentObjId = 5 + idx * 3;

      offsets[pageObjId] = currentOffset;
      addText(`${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 ${imgObjId} 0 R >> >> /MediaBox [0 0 ${pg.w} ${pg.h}] /Contents ${contentObjId} 0 R >>\nendobj\n`);

      offsets[imgObjId] = currentOffset;
      addText(`${imgObjId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`);
      addBytes(pg.bytes);
      addText("\nendstream\nendobj\n");

      const streamContent = `q ${pg.w} 0 0 ${pg.h} 0 0 cm /Im0 Do Q\n`;
      offsets[contentObjId] = currentOffset;
      addText(`${contentObjId} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream\nendobj\n`);
    });

    const xrefOffset = currentOffset;
    const totalObjs = 3 + pageJpegs.length * 3;
    const pad = (n) => String(n).padStart(10, '0');
    let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
    for (let id = 1; id < totalObjs; id++) {
      xref += `${pad(offsets[id])} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    addText(xref + trailer);

    const pdfBlob = new Blob(chunks, { type: 'application/pdf' });
    const link = document.createElement('a');
    link.download = `個資已遮蔽_安全版_${new Date().getTime()}.pdf`;
    link.href = URL.createObjectURL(pdfBlob);
    link.click();
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});