chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scan") {
    scanAndHighlight(request.customWords, request.detectNames);
  } else if (request.action === "mask") {
    applyMask(request.style);
  }
});

function scanAndHighlight(customWordsStr, detectNames) {
  let patterns = [
    "(09\\d{2}-?\\d{3}-?\\d{3})",
    "(0\\d{1,2}-?\\d{6,8})",
    "([A-Z][12]\\d{8})",
    "([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})"
  ];

  if (detectNames) {
    const surnames = "陳林黃張李王吳劉蔡楊許鄭謝郭洪邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾彭游詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董溫唐藍石蔣古紀姚連馮歐程湯田康姜白汪鄒尤巫黎塗龔嚴韓袁金童陸夏柳";
    patterns.push(`([${surnames}][\\u4e00-\\u9fa5]{1,2})`);
  }

  if (customWordsStr && customWordsStr.trim() !== "") {
    const words = customWordsStr.split(/[,，]/).map(w => w.trim()).filter(w => w.length > 0);
    words.forEach(w => {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push(`(${escaped})`);
    });
  }

  const regex = new RegExp(patterns.join("|"), "g");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let nodesToReplace = [];
  let node;

  while (node = walker.nextNode()) {
    if (node.parentElement && !['SCRIPT', 'STYLE', 'MARK'].includes(node.parentElement.tagName)) {
      if (regex.test(node.nodeValue)) {
        nodesToReplace.push(node);
      }
    }
  }

  if (nodesToReplace.length === 0) {
    alert("在目前網頁找不到可標記的純文字。\n\n💡 如果你正在看「Google 試算表」或「圖片」，請改按選單最上方的橘色按鈕「📸 擷取目前畫面進行遮蔽」！");
    return;
  }

  nodesToReplace.forEach(textNode => {
    const span = document.createElement('span');
    span.innerHTML = textNode.nodeValue.replace(regex, (match) => {
      return `<mark class="pii-candidate" data-original="${match}" style="background-color: #ffeb3b; cursor: pointer; padding: 2px; border-radius: 3px;" title="點擊可取消遮蔽">${match}</mark>`;
    });
    textNode.parentNode.replaceChild(span, textNode);
  });
  
  alert(`掃描完成！共標出 ${document.querySelectorAll('.pii-candidate').length} 處資料。\n\n👉 點擊黃色標記可取消遮蔽\n👉 確認後請回右上角選單按「執行網頁遮蔽」`);
  
  document.querySelectorAll('.pii-candidate').forEach(mark => {
    mark.addEventListener('click', function() {
      if (this.classList.contains('pii-candidate')) {
        this.style.backgroundColor = 'transparent';
        this.classList.remove('pii-candidate');
      } else {
        this.style.backgroundColor = '#ffeb3b';
        this.classList.add('pii-candidate');
      }
    });
  });
}

function applyMask(style) {
  document.querySelectorAll('.pii-candidate').forEach(mark => {
    const originalText = mark.getAttribute('data-original');
    if (style === "star") {
      mark.textContent = originalText.replace(/./g, '*');
      mark.style = "background-color: transparent; color: #d32f2f; font-weight: bold;";
    } else if (style === "circle") {
      mark.textContent = originalText.replace(/./g, 'O');
      mark.style = "background-color: transparent; color: #d32f2f; font-weight: bold;";
    } else if (style === "blur") {
      // 調強為 10px 重度模糊
      mark.style = "background-color: transparent; filter: blur(10px); user-select: none;";
    }
    mark.classList.remove('pii-candidate');
  });
}