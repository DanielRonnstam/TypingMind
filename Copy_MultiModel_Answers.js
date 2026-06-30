/* ===========================================================================
 * TypingMind Extension: "//c" — Copy last multi-model answers to clipboard
 * ---------------------------------------------------------------------------
 * Type  //c  in the chat box (then press Enter) right after a multi-model
 * reply. The original prompt + every model's answer (with model titles and
 * Markdown formatting) is copied to your clipboard, ready to paste into an
 * Agent chat. A toast shows: "n AI answers copied to clipboard."
 * ========================================================================= */
(function () {
  'use strict';

  /* -----------------------------------------------------------------------
   * CONFIG — adjust these selectors if a TypingMind update changes the DOM.
   * Turn DEBUG on to log what the extension finds (open the browser console).
   * --------------------------------------------------------------------- */
  const CONFIG = {
    TRIGGER: '//c',
    DEBUG: false,

    // Scroll/message container
    containerSelectors: [
      '[data-element-id="chat-space-middle-part"]',
      '[data-element-id="chat-space-end-part"]',
      'main',
    ],
    // Ordered list of every message bubble (user + AI)
    userMsgSelectors: ['[data-element-id="user-message"]'],
    aiMsgSelectors: ['[data-element-id="ai-response"]'],
    // The rendered markdown content inside a bubble (first match wins)
    contentSelectors: ['[data-element-id="message-content"]', '.prose', '.markdown', ':scope'],
    // The block that wraps one AI answer (used to find the model name)
    blockSelectors: ['[data-element-id="response-block"]'],
    // Where the model name is displayed inside the block
    modelNameSelectors: [
      '[data-element-id="model-name"]',
      '[data-element-id="response-model"]',
      '[class*="model"]',
    ],
  };

  /* ----------------------------- helpers -------------------------------- */
  const log = (...a) => CONFIG.DEBUG && console.log('[//c]', ...a);

  function firstMatch(root, selectors) {
    for (const s of selectors) {
      try {
        const el = s === ':scope' ? root : root.querySelector(s);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function queryAllOrdered(root, selectors) {
    // Returns all elements (matching any selector) in DOM order, de-duplicated.
    const set = new Set();
    selectors.forEach((s) => root.querySelectorAll(s).forEach((e) => set.add(e)));
    return [...set].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
  }

  /* --------------------- HTML -> Markdown converter --------------------- */
  function htmlToMd(node) {
    if (!node) return '';
    let md = '';
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) { md += child.textContent; return; }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = child.tagName.toLowerCase();
      const inner = () => htmlToMd(child);
      switch (tag) {
        case 'strong': case 'b': md += '**' + inner().trim() + '**'; break;
        case 'em': case 'i': md += '*' + inner().trim() + '*'; break;
        case 'del': case 's': md += '~~' + inner().trim() + '~~'; break;
        case 'a':
          md += '[' + inner().trim() + '](' + (child.getAttribute('href') || '') + ')';
          break;
        case 'code':
          if (child.parentElement && child.parentElement.tagName.toLowerCase() === 'pre') md += inner();
          else md += '`' + child.textContent + '`';
          break;
        case 'pre': {
          const codeEl = child.querySelector('code');
          const lang = codeEl ? (codeEl.className.match(/language-([\w-]+)/) || [])[1] || '' : '';
          const txt = (codeEl ? codeEl.textContent : child.textContent).replace(/\n$/, '');
          md += '\n```' + (lang || '') + '\n' + txt + '\n```\n';
          break;
        }
        case 'br': md += '\n'; break;
        case 'p': md += '\n' + inner().trim() + '\n'; break;
        case 'h1': md += '\n# ' + inner().trim() + '\n'; break;
        case 'h2': md += '\n## ' + inner().trim() + '\n'; break;
        case 'h3': md += '\n### ' + inner().trim() + '\n'; break;
        case 'h4': md += '\n#### ' + inner().trim() + '\n'; break;
        case 'h5': md += '\n##### ' + inner().trim() + '\n'; break;
        case 'h6': md += '\n###### ' + inner().trim() + '\n'; break;
        case 'blockquote':
          md += '\n' + inner().trim().split('\n').map((l) => '> ' + l).join('\n') + '\n';
          break;
        case 'ul': md += '\n' + listToMd(child, false) + '\n'; break;
        case 'ol': md += '\n' + listToMd(child, true) + '\n'; break;
        case 'hr': md += '\n---\n'; break;
        case 'table': md += '\n' + tableToMd(child) + '\n'; break;
        case 'img':
          md += '![' + (child.getAttribute('alt') || '') + '](' + (child.getAttribute('src') || '') + ')';
          break;
        case 'button': case 'svg': case 'style': case 'script': break; // ignore UI chrome
        default: md += inner();
      }
    });
    return md;
  }

  function listToMd(listEl, ordered) {
    let i = 1; const out = [];
    [...listEl.children].forEach((li) => {
      if (li.tagName.toLowerCase() !== 'li') return;
      const marker = ordered ? i++ + '. ' : '- ';
      const content = htmlToMd(li).trim().replace(/\n/g, '\n  ');
      out.push(marker + content);
    });
    return out.join('\n');
  }

  function tableToMd(tableEl) {
    const rows = [...tableEl.querySelectorAll('tr')];
    if (!rows.length) return '';
    const out = [];
    rows.forEach((tr, idx) => {
      const cells = [...tr.children].map((td) => htmlToMd(td).trim().replace(/\|/g, '\\|'));
      out.push('| ' + cells.join(' | ') + ' |');
      if (idx === 0) out.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    });
    return out.join('\n');
  }

  const tidy = (s) => s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();

  /* ------------------- locate the last multi-model turn ----------------- */
  function collectLastTurn() {
    const container =
      firstMatch(document, CONFIG.containerSelectors) || document.body;

    const all = queryAllOrdered(container, [
      ...CONFIG.userMsgSelectors,
      ...CONFIG.aiMsgSelectors,
    ]);
    if (!all.length) { log('No messages found'); return null; }

    const isUser = (el) =>
      CONFIG.userMsgSelectors.some((s) => el.matches(s));

    // Find the LAST user message — its replies are the most recent turn.
    let lastUserIdx = -1;
    all.forEach((el, i) => { if (isUser(el)) lastUserIdx = i; });
    if (lastUserIdx === -1) { log('No user message found'); return null; }

    const promptEl = all[lastUserIdx];
    const answerEls = all.slice(lastUserIdx + 1).filter((el) => !isUser(el));
    if (!answerEls.length) { log('No AI answers after the last prompt'); return null; }

    return { promptEl, answerEls };
  }

  function getModelTitle(answerEl, index) {
    let block = answerEl;
    for (const s of CONFIG.blockSelectors) {
      const b = answerEl.closest(s);
      if (b) { block = b; break; }
    }
    const nameEl = firstMatch(block, CONFIG.modelNameSelectors);
    const name = nameEl ? nameEl.textContent.trim() : '';
    return name || 'Model ' + (index + 1);
  }

  function buildOutput() {
    const turn = collectLastTurn();
    if (!turn) return null;

    const promptMd = tidy(htmlToMd(firstMatch(turn.promptEl, CONFIG.contentSelectors)));

    const parts = [];
    const htmlParts = [];
    parts.push('**Prompt:**\n\n' + promptMd + '\n\n---\n');
    htmlParts.push('<p><strong>Prompt:</strong></p>' +
      (firstMatch(turn.promptEl, CONFIG.contentSelectors)?.innerHTML || '') + '<hr/>');

    turn.answerEls.forEach((el, i) => {
      const title = getModelTitle(el, i);
      const contentEl = firstMatch(el, CONFIG.contentSelectors);
      const md = tidy(htmlToMd(contentEl));
      parts.push('## ' + title + '\n\n' + md + '\n\n---\n');
      htmlParts.push('<h2>' + title + '</h2>' + (contentEl?.innerHTML || '') + '<hr/>');
    });

    return {
      text: tidy(parts.join('\n')),
      html: htmlParts.join('\n'),
      count: turn.answerEls.length,
    };
  }

  /* ---------------------------- clipboard ------------------------------- */
  async function copyToClipboard(text, html) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
        return true;
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch (e2) { log('Clipboard failed', e2); return false; }
    }
  }

  /* ----------------------------- toast ---------------------------------- */
  function toast(msg, ok = true) {
    let el = document.getElementById('tm-copyc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tm-copyc-toast';
      el.style.cssText =
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'z-index:2147483647;padding:10px 18px;border-radius:8px;font:14px/1.4 ' +
        '-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;box-shadow:0 4px 14px ' +
        'rgba(0,0,0,.25);opacity:0;transition:opacity .2s ease;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.style.background = ok ? '#16a34a' : '#dc2626';
    el.textContent = msg;
    requestAnimationFrame(() => (el.style.opacity = '1'));
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.opacity = '0'), 2200);
  }

  /* --------------------------- input clearing --------------------------- */
  function clearInput(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        'value'
      ).set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      el.innerText = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* ----------------------------- run ------------------------------------ */
  async function run(inputEl) {
    const out = buildOutput();
    if (!out) { toast('No multi-model answer found.', false); return; }
    const ok = await copyToClipboard(out.text, out.html);
    if (ok) {
      toast(out.count + ' AI answer' + (out.count === 1 ? '' : 's') + ' copied to clipboard.');
    } else {
      toast('Copy failed — check clipboard permissions.', false);
    }
  }

  /* ------------------------- trigger listener --------------------------- */
  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (!t) return;
      const isText = t.tagName === 'TEXTAREA' || t.tagName === 'INPUT';
      const isCE = t.isContentEditable;
      if (!isText && !isCE) return;

      const val = (isText ? t.value : t.innerText).trim();
      if (val !== CONFIG.TRIGGER) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      clearInput(t);
      run(t);
    },
    true // capture phase, so we beat TypingMind's own send handler
  );

  log('Extension loaded. Type', CONFIG.TRIGGER, 'after a multi-model reply.');
})();
