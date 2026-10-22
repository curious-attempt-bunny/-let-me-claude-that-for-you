(function () {
  "use strict";

  const qs = new URLSearchParams(window.location.search);
  const sharedQuestion = qs.get("q");

  const landingView = document.getElementById("landing-view");
  const sharedView = document.getElementById("shared-view");

  if (sharedQuestion) {
    landingView.classList.add("hidden");
    sharedView.classList.remove("hidden");
    runSharedView(sharedQuestion);
  } else {
    initLanding();
  }

  function initLanding() {
    const form = document.getElementById("ask-form");
    const input = document.getElementById("question-input");
    const linkResult = document.getElementById("link-result");
    const copyBtn = document.getElementById("copy-link-btn");
    const copyStatus = document.getElementById("copy-status");
    const jumpParodyBtnInitial = document.getElementById("jump-parody-btn-initial");

    let generatedUrl = "";
    let currentQuestion = "";

    input.addEventListener("input", function () {
      jumpParodyBtnInitial.disabled = !input.value.trim();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const question = input.value.trim();
      if (!question) return;
      currentQuestion = question;

      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("q", question);
      generatedUrl = url.toString();

      linkResult.classList.remove("hidden");
      copyStatus.textContent = "";
    });

    copyBtn.addEventListener("click", async function () {
      if (!generatedUrl) return;
      try {
        await navigator.clipboard.writeText(generatedUrl);
        copyStatus.textContent = "Copied!";
      } catch (err) {
        copyStatus.textContent = generatedUrl;
      }
    });

    jumpParodyBtnInitial.addEventListener("click", function () {
      const question = input.value.trim();
      if (!question) return;
      jumpParodyBtnInitial.disabled = true;
      landingView.classList.add("hidden");
      startParodyMode(question);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runSharedView(question) {
    const cursor = document.getElementById("cursor");
    const mouseStage = document.getElementById("mouse-stage");
    const typingBox = document.getElementById("typing-box");
    const typedText = document.getElementById("typed-text");
    const askClaudeBtn = document.getElementById("ask-claude-btn");
    const parodyBtn = document.getElementById("parody-btn");

    await animateMouseToBox(cursor, mouseStage, typingBox);
    await typeText(typedText, question);

    askClaudeBtn.classList.remove("hidden");
    parodyBtn.classList.remove("hidden");

    askClaudeBtn.addEventListener("click", function () {
      window.open("https://claude.ai/new?q=" + encodeURIComponent(question), "_blank");
    });

    parodyBtn.addEventListener("click", function () {
      parodyBtn.disabled = true;
      startParodyMode(question);
    });
  }

  async function animateMouseToBox(cursor, stage, targetBox) {
    const stageRect = stage.getBoundingClientRect();
    const targetRect = targetBox.getBoundingClientRect();

    const startX = 8;
    const startY = 8;
    // Land the cursor tip on the box's text area, overlapping it (the
    // cursor sits above the box in z-order so it's visible on top).
    const endX = targetRect.left - stageRect.left + 24;
    const endY = targetRect.top - stageRect.top + targetRect.height / 2 - 4;

    cursor.classList.remove("fade-out", "clicked");
    cursor.style.opacity = "1";
    cursor.style.left = startX + "px";
    cursor.style.top = startY + "px";
    cursor.style.transition = "none";

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    cursor.style.transition = "left 1.8s ease-in-out, top 1.8s ease-in-out";
    cursor.style.left = endX + "px";
    cursor.style.top = endY + "px";

    await sleep(2000);

    // "Click" the box: a quick pulse, then the cursor fades away.
    cursor.classList.add("clicked");
    await sleep(120);
    cursor.classList.remove("clicked");
    cursor.classList.add("fade-out");
    await sleep(400);
    cursor.style.display = "none";
  }

  async function typeText(el, text) {
    el.classList.remove("placeholder");
    el.textContent = "";
    for (let i = 0; i < text.length; i++) {
      el.textContent += text[i];
      await sleep(45 + Math.random() * 40);
    }
  }

  // ---- Parody mode ----

  let pyodideInstance = null;
  let conversationCount = 0;
  let convRoleMeta = [];
  let bridgeLines = { human: [], bot: [] };
  let genericPushback = [];

  async function loadPyodideAndNltk(statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.textContent = "Loading parody-answer engine…";

    if (!pyodideInstance) {
      pyodideInstance = await loadPyodide();
    }

    statusEl.textContent = "Loading language data…";
    await pyodideInstance.loadPackage("nltk");

    await fetchNltkDataIntoFS(pyodideInstance, statusEl);

    statusEl.textContent = "Loading madlib generator…";
    const [madlibPy, templatesJson] = await Promise.all([
      fetch("madlib.py").then((r) => r.text()),
      fetch("data/templates.json").then((r) => r.text()),
    ]);

    pyodideInstance.FS.mkdirTree("/app/data");
    pyodideInstance.FS.writeFile("/app/madlib.py", madlibPy);
    pyodideInstance.FS.writeFile("/app/data/templates.json", templatesJson);

    const parsedTemplates = JSON.parse(templatesJson);
    conversationCount = parsedTemplates.mini_conversations.length;
    convRoleMeta = parsedTemplates.mini_conversations.map((c) => ({
      first: c.turns[0].role,
      last: c.turns[c.turns.length - 1].role,
    }));
    bridgeLines = parsedTemplates.bridge_lines || { human: [], bot: [] };
    genericPushback = parsedTemplates.generic_pushback || [];

    pyodideInstance.runPython(`
import sys
sys.path.insert(0, "/app")
import nltk
nltk.data.path.insert(0, "/nltk_data")
import importlib
import madlib
importlib.reload(madlib)
`);

    statusEl.classList.add("hidden");
  }

  const NLTK_FILES = [
    "tokenizers/punkt/english.pickle",
    "tokenizers/punkt/PY3/english.pickle",
    "tokenizers/punkt_tab/english/sent_starters.txt",
    "tokenizers/punkt_tab/english/abbrev_types.txt",
    "tokenizers/punkt_tab/english/ortho_context.tab",
    "tokenizers/punkt_tab/english/collocations.tab",
    "taggers/averaged_perceptron_tagger/averaged_perceptron_tagger.pickle",
    "taggers/averaged_perceptron_tagger_eng/averaged_perceptron_tagger_eng.weights.json",
    "taggers/averaged_perceptron_tagger_eng/averaged_perceptron_tagger_eng.classes.json",
    "taggers/averaged_perceptron_tagger_eng/averaged_perceptron_tagger_eng.tagdict.json",
  ];

  async function fetchNltkDataIntoFS(pyodide, statusEl) {
    const dirs = new Set();
    for (const relPath of NLTK_FILES) {
      const parts = relPath.split("/");
      let acc = "/nltk_data";
      for (let i = 0; i < parts.length - 1; i++) {
        acc += "/" + parts[i];
        dirs.add(acc);
      }
    }
    for (const d of dirs) {
      pyodide.FS.mkdirTree(d);
    }

    for (const relPath of NLTK_FILES) {
      statusEl.textContent = "Loading language data… (" + relPath + ")";
      const resp = await fetch("data/nltk_data/" + relPath);
      const buf = new Uint8Array(await resp.arrayBuffer());
      pyodide.FS.writeFile("/nltk_data/" + relPath, buf);
    }
  }

  async function startParodyMode(question) {
    const fullscreen = document.getElementById("parody-fullscreen");
    const loadingStatus = document.getElementById("loading-status");
    const chat = document.getElementById("chat");

    document.getElementById("shared-view").classList.add("hidden");
    document.getElementById("page-footer").classList.add("hidden");
    fullscreen.classList.remove("hidden");

    await printBubble(chat, "user", question, { instant: true });

    try {
      await loadPyodideAndNltk(loadingStatus);
    } catch (err) {
      loadingStatus.textContent = "Failed to load parody engine: " + err;
      return;
    }

    let session;
    try {
      session = generateSession(question);
    } catch (err) {
      loadingStatus.classList.remove("hidden");
      loadingStatus.textContent = "Parody generation failed: " + err;
      return;
    }

    await printBubble(chat, "bot", session.first_answer);

    // Warm up with several rounds of plain, unscripted AI rambling plus
    // generic terse pushback before dropping into the scripted
    // mini-conversation threads below, so the scripted material doesn't
    // start on message two.
    const warmupRounds = 5 + Math.floor(Math.random() * 3); // 5-7 rounds
    const usedPushback = new Set();
    for (let i = 0; i < warmupRounds; i++) {
      await printBubbleTyped(chat, "user", pickPushbackLine(usedPushback));
      await sleep(500 + Math.random() * 400);
      await printBubble(chat, "bot", generateAnswer(question));
    }

    // Work through every mini-conversation thread exactly once, in a
    // shuffled order, then end the session — no thread repeats. Every
    // conversation alternates human/bot internally, but conversations
    // differ in which role they start and end on, so a naive shuffle can
    // place two same-role turns back to back at a conversation boundary.
    // Reorder greedily to avoid that; when no remaining conversation can
    // continue the alternation (there are more bot-ending conversations
    // than human-starting ones, so this does happen), insert one short,
    // neutral bridge line of the needed role to flip it before continuing.
    const shuffleOrder = shuffledRange(conversationCount);
    const remaining = new Set(shuffleOrder);
    let lastRole = "bot"; // the opening answer above was a bot turn

    while (remaining.size > 0) {
      let chosen = null;
      for (const idx of shuffleOrder) {
        if (remaining.has(idx) && convRoleMeta[idx].first !== lastRole) {
          chosen = idx;
          break;
        }
      }

      if (chosen === null) {
        const neededRole = lastRole === "bot" ? "human" : "bot";
        const pool = bridgeLines[neededRole];
        if (pool && pool.length) {
          const line = pool[Math.floor(Math.random() * pool.length)];
          if (neededRole === "human") {
            await printBubbleTyped(chat, "user", line);
          } else {
            await sleep(400 + Math.random() * 300);
            await printBubble(chat, "bot", line);
          }
          lastRole = neededRole;
          continue;
        }
        chosen = [...remaining][0];
      }

      remaining.delete(chosen);
      const convo = generateMiniConversation(question, chosen);
      for (const turn of convo.turns) {
        if (turn.role === "human") {
          await printBubbleTyped(chat, "user", turn.text);
        } else {
          await sleep(500 + Math.random() * 400);
          await printBubble(chat, "bot", turn.text);
        }
      }
      lastRole = convRoleMeta[chosen].last;
    }

    await sleep(700);
    await printSystemNotice(chat, "Tokens exhausted.");
  }

  function shuffledRange(n) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function generateSession(question) {
    const escaped = JSON.stringify(question);
    const result = pyodideInstance.runPython(`
import json
_templates = madlib.load_templates("/app/data/templates.json")
madlib.generate_session(json.loads(${JSON.stringify(escaped)}), _templates)
`);
    return result.toJs({ dict_converter: Object.fromEntries });
  }

  function generateMiniConversation(question, convIndex) {
    const escaped = JSON.stringify(question);
    const result = pyodideInstance.runPython(`
import json
_templates = madlib.load_templates("/app/data/templates.json")
madlib.generate_mini_conversation(json.loads(${JSON.stringify(escaped)}), _templates, conv_index=${convIndex})
`);
    return result.toJs({ dict_converter: Object.fromEntries });
  }

  function generateAnswer(question) {
    const escaped = JSON.stringify(question);
    return pyodideInstance.runPython(`
import json
_templates = madlib.load_templates("/app/data/templates.json")
madlib.generate_answer(json.loads(${JSON.stringify(escaped)}), _templates)
`);
  }

  function pickPushbackLine(used) {
    if (used.size >= genericPushback.length) used.clear();
    let line;
    do {
      line = genericPushback[Math.floor(Math.random() * genericPushback.length)];
    } while (used.has(line) && used.size < genericPushback.length);
    used.add(line);
    return line;
  }

  // Only auto-scroll to the latest message if the user is already near
  // the bottom, so scrolling up to reread earlier messages isn't fought
  // by the streaming content snapping back down.
  function scrollChatToBottom() {
    const scroller = document.getElementById("chat-scroll");
    if (!scroller) return;
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom < 150) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Minimal markdown renderer for bot bubbles: **bold** and "- " bullet
  // lines. Deliberately only converts *matched* markers — while a response
  // is still streaming in, an unclosed "**" or a bullet dash with no
  // content yet shows up as literal, slightly broken markup, the same way
  // real streaming chat UIs flicker before the formatting resolves.
  function renderMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");

    const lines = html.split("\n");
    const out = [];
    let inList = false;
    for (const line of lines) {
      if (/^-\s+/.test(line)) {
        if (!inList) {
          out.push("<ul>");
          inList = true;
        }
        out.push("<li>" + line.replace(/^-\s+/, "") + "</li>");
      } else {
        if (inList) {
          out.push("</ul>");
          inList = false;
        }
        if (line.trim() === "") {
          out.push("<br>");
        } else {
          out.push("<p>" + line + "</p>");
        }
      }
    }
    if (inList) out.push("</ul>");
    return out.join("");
  }

  async function printBubble(chat, role, text, opts) {
    opts = opts || {};
    const bubble = document.createElement("div");
    bubble.className = "bubble " + role;
    chat.appendChild(bubble);
    scrollChatToBottom();

    if (opts.instant) {
      bubble.innerHTML = renderMarkdown(text);
      scrollChatToBottom();
      return;
    }

    // Character-by-character so markdown markers stream in visibly
    // unresolved before they snap into formatting once complete.
    for (let i = 1; i <= text.length; i++) {
      bubble.innerHTML = renderMarkdown(text.slice(0, i));
      scrollChatToBottom();
      await sleep(8 + Math.random() * 10);
    }
  }

  // Simulates a plausible human typist, but in the composer at the bottom
  // of the screen rather than directly in the chat log: a pause before
  // they start (reading and reacting), then character-by-character entry
  // into the composer with a blinking caret, roughly half the speed of the
  // original fast-typist version, with the occasional brief pause
  // (thinking, or hitting backspace-and-retype) rather than perfectly even
  // spacing. Once finished, the composer clears and the finished message
  // appears as a new bubble in the chat, like it was just "sent".
  async function printBubbleTyped(chat, role, text) {
    await sleep(700 + Math.random() * 900);

    const composerText = document.getElementById("composer-text");
    const inputBox = composerText.parentElement;
    composerText.classList.remove("placeholder");
    composerText.textContent = "";

    const caret = document.createElement("span");
    caret.className = "cursor-caret";
    inputBox.appendChild(caret);

    for (let i = 0; i < text.length; i++) {
      composerText.textContent = text.slice(0, i + 1);
      let delay = 32 + Math.random() * 56;
      if (" ,.!?".includes(text[i])) {
        delay += Math.random() * 180;
      }
      await sleep(delay);
    }

    await sleep(300 + Math.random() * 300);
    caret.remove();

    composerText.textContent = "Claude is not actually listening…";
    composerText.classList.add("placeholder");

    await printBubble(chat, role, text, { instant: true });
  }

  async function printSystemNotice(chat, text) {
    const notice = document.createElement("div");
    notice.className = "bubble system-notice";
    notice.textContent = text;
    chat.appendChild(notice);
    scrollChatToBottom();
  }
})();
