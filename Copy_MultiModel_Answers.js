/*!
 * TypingMind Extension — Copy Multi-Model Answers ("//c")
 * --------------------------------------------------------
 * Type  //c  in the chat box (then Enter) after a multi-model reply to copy
 * the prompt + every model's answer (with model titles, Markdown formatting)
 * to the clipboard as plain text. Shows "n AI answers copied to clipboard."
 *
 * Install in TypingMind (Settings → Advanced → Extensions) via jsDelivr:
 *   https://cdn.jsdelivr.net/gh/DanielRonnstam/TypingMind@main/Copy_MultiModel_Answers.js
 *
 * Author: Daniel Rönnstam
 * License: MIT
 */
(function () {
  'use strict';

  // Prevent double-initialisation if the script is injected more than once.
  if (window.__tmCopyMultiModelLoaded) return;
  window.__tmCopyMultiModelLoaded = true;

  /* ----------------------------- CONFIG --------------------------------- */
  const CONFIG = {
    TRIGGER: '//c',
    DEBUG: false, // set true and check the browser console if titles/counts look wrong

    containerSelectors: [
      '[data-element-id="chat-space-middle-part"]',
      '[data-element-id="chat-space-end-part"]',
      'main',
    ],
    userMsgSelectors: ['[data-element-id="user-message"]'],
    aiMsgSelectors: ['[data-element-id="ai-response"]'],
    contentSelectors: ['[data-element-id="message-content"]', '.prose', '.markdown', ':scope'],
    blockSelectors: [
      '[data-element-id="response-block"]',
      '[data-element-id="ai-response-block"]',
      '[data-element-id="chat-message"]',
    ],
    modelNameSelectors: [
      '[data-element-id="model-name"]',
      '[data-element-id="response-model"]',
      '[data-element-id="model-title"]',
      '[data-element-id="ai-model-name"]',
      '[data-element-id="message-model-name"]',
      '[data-element-id="response-model-name"]',
      '[class*="model-name"]',
      '[class*="modelName"]',
      '[class*="model-title"]',
    ],
  };

  const MODEL_RE = /\b(gpt[\w.\- ]*|chatgpt[\w.\- ]*|o[1-9]\d?[\w.\-]*|claude[\w.\- ]*|sonnet[\w.\- ]*|opus[\w.\- ]*|haiku[\w.\- ]*|gemini[\w.\- ]*|gemma[\w.\-]*|bard|palm[\w.\- ]*|llama[\w.\- ]*|mistral[\w.\- ]*|mixtral[\w.\- ]*|codestral[\w.\- ]*|grok[\w.\-]*|deepseek[\w.\- ]*|qwen[\w.\- ]*|command[\w.\- ]*r?[\w.\-]*|cohere[\w.\- ]*|perplexity[\w.\- ]*|sonar[\w.\- ]*|phi[\w.\-]*|nova[\w.\- ]*|yi[\w.\-]*|jamba[\w.\- ]*|reka[\w.\- ]*|titan[\w.\- ]*)\b/i;

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
        case 'a': md += '[' + inner().trim() + '](' + (child.getAttribute('href') || '') + ')'; break;
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
          md += '\n' + inner().trim().split('\n').map((l) => '> ' + l).join('\n') + '\n'; break;
        case 'ul': md += '\n' + listToMd(child, false) + '\n'; break;
        case 'ol': md += '\n' + listToMd(child, true) + '\n'; break;
        case 'hr': md += '\n---\n'; break;
        case 'table': md += '\n' + tableToMd(child) + '\n'; break;
        case 'img': md += '![' + (child.getAttribute('alt') || '') + '](' + (child.getAttribute('src') || '') + ')'; break;
        case 'button': case 'svg': case 'style': case 'script': break;
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
      out.push(marker + htmlToMd(li).trim().replace(/\n/g, '\n  '));
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

  /* --------------------- title (model name) detection ------------------- */
  // Clean a raw model label: strip leading icons/avatars text, trailing
  // separators, "·", token counts, timestamps, etc.
  function cleanModelLabel(raw) {
    if (!raw) return '';
    let t = raw.replace(/\s+/g, ' ').trim();
    // Cut off anything after a common separator that usually precedes metadata.
    t = t.split(/[·•|]/)[0].trim();
    // Drop trailing "copy"/"regenerate" style words that sometimes glue on.
    t = t.replace(/\b(copy|regenerate|edit|share|retry)\b.*$/i, '').trim();
    return t;
  }

  function getBlockFor(answerEl) {
    for (const s of CONFIG.blockSelectors) {
      const b = answerEl.closest(s);
      if (b) return b;
    }
    return answerEl.parentElement || answerEl;
  }

  function findModelTitle(answerEl, index) {
    const block = getBlockFor(answerEl);

    // 1) Explicit, purpose-built selectors first.
    const explicit = firstMatch(block, CONFIG.modelNameSelectors);
    if (explicit && explicit.textContent.trim()) {
      const cleaned = cleanModelLabel(explicit.textContent);
      if (cleaned) return cleaned;
    }

    // 2) Attributes (title/aria-label/alt) that look like model names.
    const attrEls = block.querySelectorAll('[title],[aria-label],[alt],[data-tooltip]');
    for (const el of attrEls) {
      const v = cleanModelLabel(
        el.getAttribute('title') ||
        el.getAttribute('aria-label') ||
        el.getAttribute('alt') ||
        el.getAttribute('data-tooltip') || ''
      );
      if (v && v.length <= 60 && MODEL_RE.test(v)) return v;
    }

    // 3) Scan leaf/short text nodes OUTSIDE the answer body for a model name.
    //    Prefer the match that is closest (earliest) to the answer element.
    let best = null;
    let bestScore = Infinity;
    block.querySelectorAll('*').forEach((el) => {
      if (el.children.length) return;          // leaf nodes only
      if (answerEl.contains(el)) return;       // ignore the answer text itself
      const t = cleanModelLabel(el.textContent);
      if (!t || t.length > 60) return;
      if (!MODEL_RE.test(t)) return;
      // Score: shorter labels and labels that match the regex more tightly win.
      const score = t.length;
      if (score < bestScore) { best = t; bestScore = score; }
    });
    if (best) return best;

    // 4) Fallback.
    return 'Model ' + (index + 1);
  }

  /* ------------------- locate the last multi-model turn ----------------- */
  function collectLastTurn() {
    const container = firstMatch(document, CONFIG.containerSelectors) || document.body;
    const all = queryAllOrdered(container, [...CONFIG.userMsgSelectors, ...CONFIG.aiMsgSelectors]);
    if (!all.length) return null;

    const isUser = (el) => CONFIG.userMsgSelectors.some((s) => el.matches(s));
    let lastUserIdx = -1;
    all.forEach((el, i) => { if (isUser(el)) lastUserIdx = i; });
    if (lastUserIdx === -1) return null;

    const promptEl = all[lastUserIdx];
    let answers = all.slice(lastUserIdx + 1).filter((el) => !isUser(el));

    // Remove answers that are nested inside another captured answer.
    answers = answers.filter((el, _, arr) => !arr.some((o) => o !== el && o.contains(el)));

    // Require non-empty content.
    answers = answers.filter((el) => {
      const c = firstMatch(el, CONFIG.contentSelectors);
      return c && c.textContent.trim().length > 0;
    });

    // --- COUNT FIX -------------------------------------------------------
    // Deduplicate by *response block* (one model = one block) instead of by
    // text. Two different models can legitimately produce identical text, so
    // text-based dedup undercounted them. Block-based dedup removes only true
    // duplicate renders (e.g. the same response mirrored in another container)
    // while keeping every distinct model answer.
    const seenBlocks = new Set();
    answers = answers.filter((el) => {
      const block = getBlockFor(el);
      if (seenBlocks.has(block)) return false;
      seenBlocks.add(block);
      return true;
    });

    log('answers found:', answers.length);
    if (!answers.length) return null;
    return { promptEl, answerEls: answers };
  }

  function buildOutput() {
    const turn = collectLastTurn();
    if (!turn) return null;
    const promptMd = tidy(htmlToMd(firstMatch(turn.promptEl, CONFIG.contentSelectors)));
    const parts = ['**Prompt:**\n\n' + promptMd + '\n\n---\n'];

    // Track used titles so duplicate model names get a #2, #3 … suffix and
    // each AI is still clearly distinguished in the output.
    const titleCounts = {};
    turn.answerEls.forEach((el, i) => {
      let title = findModelTitle(el, i);
      if (titleCounts[title]) {
        titleCounts[title] += 1;
        title = title + ' #' + titleCounts[title];
      } else {
        titleCounts[title] = 1;
      }
      const md = tidy(htmlToMd(firstMatch(el, CONFIG.contentSelectors)));
      parts.push('## ' + title + '\n\n' + md + '\n\n---\n');
    });
    return { text: tidy(parts.join('\n')), count: turn.answerEls.length };
  }

  /* ---------------------------- clipboard (plain text only) ------------- */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) { log('clipboard failed', e2); return false; }
    }
  }

  /* ----------------------------- toast ---------------------------------- */
  function toast(msg, ok = true) {
    let el = document.getElementById('tm-copyc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tm-copyc-toast';
      el.style.cssText =
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
        'padding:10px 18px;border-radius:8px;font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;' +
        'color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:0;transition:opacity .2s;pointer-events:none;';
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
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      el.innerText = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* ----------------------------- run ------------------------------------ */
  async function run() {
    const out = buildOutput();
    if (!out) { toast('No multi-model answer found.', false); return; }
    const ok = await copyToClipboard(out.text);
    if (ok) toast(out.count + ' AI answer' + (out.count === 1 ? '' : 's') + ' copied to clipboard.');
    else toast('Copy failed — check clipboard permissions.', false);
  }

  /* --------------------------- init ------------------------------------- */
  function init() {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (!t) return;
      const isText = t.tagName === 'TEXTAREA' || t.tagName === 'INPUT';
      if (!isText && !t.isContentEditable) return;
      const val = (isText ? t.value : t.innerText).trim();
      if (val !== CONFIG.TRIGGER) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      clearInput(t);
      run();
    }, true);
    log('Copy Multi-Model Answers extension loaded.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
