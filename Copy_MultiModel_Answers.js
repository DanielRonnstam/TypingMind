/*!
 * TypingMind Extension — Copy Multi-Model Answers ("//c")
 * --------------------------------------------------------
 * Type  //c  in the chat box (then Enter) after a multi-model reply to copy
 * the prompt + every model's answer (with model titles, Markdown formatting)
 * to the clipboard as plain text. Shows "n AI answers copied to clipboard."
 *
 * Author: Daniel Rönnstam
 * License: MIT
 */
(function () {
  'use strict';

  if (window.__tmCopyMultiModelLoaded) return;
  window.__tmCopyMultiModelLoaded = true;

  /* ----------------------------- CONFIG --------------------------------- */
  const CONFIG = {
    TRIGGER: '//c',
    DEBUG: false, // set true to log title/count detection in the console

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
    // data-* attributes that frequently carry the raw model id/name.
    modelAttrNames: [
      'data-model', 'data-model-name', 'data-model-id', 'data-model-title',
      'data-modelname', 'data-name', 'title', 'aria-label', 'alt', 'data-tooltip',
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
        case 'hr': md += '\
