// 直接開啟空白工作台（用來拖入 PDF 或圖片）
document.getElementById('openPdfWorkspaceBtn').addEventListener('click', () => {
  chrome.storage.local.remove('capturedImage', () => {
    chrome.tabs.create({ url: 'editor.html' });
  });
});

// 擷取當前畫面（適合 Google 試算表）
document.getElementById('captureBtn').addEventListener('click', () => {
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      alert("無法擷取此頁面（Chrome 設定頁無法截圖，請切換到試算表或一般網頁再試）。");
      return;
    }
    chrome.storage.local.set({ capturedImage: dataUrl }, () => {
      chrome.tabs.create({ url: 'editor.html' });
    });
  });
});

// 掃描一般網頁
document.getElementById('scanBtn').addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let customWords = document.getElementById('customWords').value;
  let detectNames = document.getElementById('detectNames').checked;

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  }).then(() => {
    chrome.tabs.sendMessage(tab.id, { 
      action: "scan", 
      customWords: customWords,
      detectNames: detectNames
    });
  }).catch(() => {
    alert("此頁面無法直接掃描文字，請改用上方的「📸 擷取目前畫面」！");
  });
});

// 執行網頁遮蔽
document.getElementById('maskBtn').addEventListener('click', async () => {
  let maskStyle = document.getElementById('maskStyle').value;
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: "mask", style: maskStyle });
});