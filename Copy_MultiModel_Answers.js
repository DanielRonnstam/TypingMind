/* ===========================================================================
 * TypingMind Extension — Copy Multi-Model Answers (button version, v4)
 * ---------------------------------------------------------------------------
 * Adds a small floating copy-icon button (bottom-right of the screen).
 * Click it to copy the LAST multi-model turn — the prompt plus every
 * model's FULL answer (even if a model's reply was rendered as several
 * chunks, they're merged into one) — to the clipboard as plain text, with
 * clear separators between models. Shows a toast with how many models'
 * answers were copied.
 *
 * WHY THIS VERSION IS DIFFERENT FROM THE PREVIOUS ONE:
 * TypingMind doesn't publish its internal DOM structure. Instead of
 * hardcoding exact `data-element-id` strings (which turned out to be wrong
 * last time and caused a silent failure), this script scans ALL
 * data-element-id attributes on the page and pattern-matches ones that
 * look like user/AI messages. If it still can't find them, clicking the
 * button copies a short diagnostic report instead of doing nothing — paste
 * that back so the selectors can be corrected precisely.
 *
 * Author: Daniel Rönnstam
 * License: MIT
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__tmCopyMultiModelBtnLoaded) return;
  window.__tmCopyMultiModelBtnLoaded = true;

  console.log('[TM Copy Button] Extension script loaded. Look for a blue round button, bottom-right of the screen.');

  const CONTENT_SELECTORS = ['[data-element-id="message-content"]', '.prose', '.markdown'];

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

  /* ---------------- full-text extraction (handles split chunks) --------- */
  function extractFullText(el) {
    let nodes = [];
    CONTENT_SELECTORS.forEach((s) => el.querySelectorAll(s).forEach((n) => nodes.push(n)));
    nodes = nodes.filter((n, _, arr) => !arr.some((o) => o !== n && o.contains(n)));
    if (!nodes.length) nodes = [el];
    nodes.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return nodes.map((n) => tidy(htmlToMd(n))).filter(Boolean).join('\n\n');
  }

  /* ------------- adaptive message discovery (pattern, not hardcoded) ---- */
  function getTaggedElements() {
    return [...document.querySelectorAll('[data-element-id]')];
  }

  function findMessageElements() {
    const tagged = getTaggedElements();
    const idOf = (el) => el.getAttribute('data-element-id') || '';
    const userEls = tagged.filter((el) => /user.*message|message.*user|human.*message|user.?turn/i.test(idOf(el)));
    const aiEls = tagged.filter((el) => /ai.*response|assistant.*message|response.*message|ai.?message|bot.?message|model.*response|response.*block/i.test(idOf(el)));
    return { userEls, aiEls, taggedCount: tagged.length };
  }

  const MODEL_RE = /\b(gpt[\w.\- ]*|chatgpt|o\d[\w.\-]*|claude[\w.\- ]*|sonnet|opus|haiku|gemini[\w.\- ]*|bard|llama[\w.\- ]*|mistral[\w.\- ]*|mixtral|grok[\w.\-]*|deepseek[\w.\- ]*|qwen[\w.\- ]*|command[\w.\- ]*r?|perplexity|sonar|phi[\w.\-]*|gemma[\w.\-]*)\b/i;

  function findModelTitle(answerEl, index) {
    let block = answerEl.closest('[data-element-id]') || answerEl.parentElement || answerEl;
    const near = getTaggedElements().filter((el) => block.contains(el) || el.contains(block));
    for (const el of near) {
      if (/model.*name|model.*title|model.*label/i.test(el.getAttribute('data-element-id') || '')) {
        const t = el.textContent.trim();
        if (t) return t;
      }
    }
    const attrEls = block.querySelectorAll('[title],[aria-label],[alt]');
    for (const el of attrEls) {
      const v = (el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim();
      if (v && v.length <= 40 && MODEL_RE.test(v)) return v;
    }
    let best = null;
    block.querySelectorAll('*').forEach((el) => {
      if (el.children.length) return;
      if (answerEl.contains(el)) return;
      const t = el.textContent.trim();
      if (!t || t.length > 40) return;
      if (MODEL_RE.test(t) && (!best || t.length < best.length)) best = t;
    });
    return best || 'Model ' + (index + 1);
  }

  /* --------------------------- turn collection --------------------------- */
  function collectLastTurn() {
    const { userEls, aiEls, taggedCount } = findMessageElements();
    if (!userEls.length || !aiEls.length) {
      return { ok: false, taggedCount, userCount: userEls.length, aiCount: aiEls.length };
    }

    const all = [...userEls, ...aiEls].sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
    );
    const userSet = new Set(userEls);
    let lastUserIdx = -1;
    all.forEach((el, i) => { if (userSet.has(el)) lastUserIdx = i; });
    if (lastUserIdx === -1) return { ok: false, taggedCount, userCount: userEls.length, aiCount: aiEls.length };

    const promptEl = all[lastUserIdx];
    let answers = all.slice(lastUserIdx + 1).filter((el) => !userSet.has(el));

    answers = answers.filter((el, _, arr) => !arr.some((o) => o !== el && o.contains(el)));
    answers = answers.filter((el) => extractFullText(el).length > 0);
    const seen = new Set();
    answers = answers.filter((el) => {
      const key = extractFullText(el);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!answers.length) return { ok: false, taggedCount, userCount: userEls.length, aiCount: aiEls.length };

    const groups = [];
    answers.forEach((el, i) => {
      const title = findModelTitle(el, i);
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.els.push(el);
      else groups.push({ title, els: [el] });
    });

    return { ok: true, promptEl, groups };
  }

  function buildOutput() {
    const turn = collectLastTurn();
    if (!turn.ok) return { ok: false, diag: turn };

    const promptEl = turn.promptEl.querySelector(CONTENT_SELECTORS.join(',')) || turn.promptEl;
    const promptMd = tidy(htmlToMd(promptEl));

    const SEP = '='.repeat(60);
    const parts = [`PROMPT:\n\n${promptMd}`];
    turn.groups.forEach((g) => {
      const md = tidy(g.els.map((el) => extractFullText(el)).filter(Boolean).join('\n\n'));
      parts.push(`${SEP}\nMODEL: ${g.title}\n${SEP}\n\n${md}`);
    });

    return { ok: true, text: parts.join('\n\n'), count: turn.groups.length };
  }

  /* ----------------------------- diagnostics ----------------------------- */
  function buildDiagnosticReport(diag) {
    const ids = [...new Set(getTaggedElements().map((el) => el.getAttribute('data-element-id')))].sort();
    return [
      'TypingMind Copy-Extension diagnostic report — paste this to Claude so the selectors can be fixed.',
      '',
      `Total elements with a data-element-id on this page: ${diag.taggedCount}`,
      `Matched as "user message": ${diag.userCount}`,
      `Matched as "AI response": ${diag.aiCount}`,
      '',
      'All unique data-element-id values currently on the page:',
      ...ids.map((id) => '  - ' + id),
    ].join('\n');
  }

  /* ------------------------------ clipboard ------------------------------ */
  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) { return false; }
    }
  }

  /* -------------------------------- toast -------------------------------- */
  function toast(msg, ok = true, duration = 2400) {
    let el = document.getElementById('tm-copyc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tm-copyc-toast';
      el.style.cssText =
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
        'max-width:80vw;padding:10px 18px;border-radius:8px;font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;' +
        'color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:0;transition:opacity .2s;pointer-events:none;text-align:center;';
      document.body.appendChild(el);
    }
    el.style.background = ok ? '#16a34a' : '#dc2626';
    el.textContent = msg;
    requestAnimationFrame(() => (el.style.opacity = '1'));
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.opacity = '0'), duration);
  }

  /* -------------------------------- click --------------------------------- */
  async function handleClick() {
    const out = buildOutput();
    if (out.ok) {
      const copied = await copyToClipboard(out.text);
      toast(
        copied
          ? `${out.count} AI answer${out.count === 1 ? '' : 's'} copied to clipboard.`
          : 'Copy failed — check clipboard permissions.',
        copied
      );
    } else {
      const report = buildDiagnosticReport(out.diag);
      const copied = await copyToClipboard(report);
      toast(
        copied
          ? 'Could not detect chat messages — copied diagnostic info instead. Paste it to Claude.'
          : 'Could not detect messages, and clipboard copy failed too.',
        false,
        4200
      );
      console.log('[TM Copy Button] Diagnostic report:\n' + report);
    }
  }

  /* ------------------------------ the button ------------------------------ */
  function createButton() {
    if (document.getElementById('tm-copy-multimodel-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'tm-copy-multimodel-btn';
    btn.type = 'button';
    btn.title = 'Copy all model answers';
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/>' +
      '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.style.cssText =
      'position:fixed; right:20px; bottom:100px; z-index:2147483000;' +
      'width:44px; height:44px; border-radius:50%; border:none;' +
      'background:#2563eb; color:#fff; display:flex; align-items:center; justify-content:center;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.3); cursor:pointer; transition:transform .15s ease;';
    btn.addEventListener('mouseenter', () => (btn.style.transform = 'scale(1.08)'));
    btn.addEventListener('mouseleave', () => (btn.style.transform = 'scale(1)'));
    btn.addEventListener('click', handleClick);
    document.body.appendChild(btn);
  }

  function ensureButtonPersists() {
    createButton();
    const obs = new MutationObserver(() => { if (!document.getElementById('tm-copy-multimodel-btn')) createButton(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButtonPersists);
  else ensureButtonPersists();
})();
