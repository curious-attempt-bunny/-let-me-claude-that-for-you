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
    const jumpParodyBtn = document.getElementById("jump-parody-btn");
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

    function jumpToParody() {
      const question = input.value.trim();
      if (!question) return;
      jumpParodyBtn.disabled = true;
      jumpParodyBtnInitial.disabled = true;
      landingView.classList.add("hidden");
      startParodyMode(question);
    }

    jumpParodyBtn.addEventListener("click", jumpToParody);
    jumpParodyBtnInitial.addEventListener("click", jumpToParody);
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

    conversationCount = JSON.parse(templatesJson).mini_conversations.length;

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

    // Work through every mini-conversation thread exactly once, in a
    // shuffled order, then end the session — no thread repeats.
    const remainingIndices = shuffledRange(conversationCount);
    for (const convIndex of remainingIndices) {
      const convo = generateMiniConversation(question, convIndex);
      for (const turn of convo.turns) {
        await sleep(500 + Math.random() * 400);
        if (turn.role === "human") {
          await printBubbleTyped(chat, "user", turn.text);
        } else {
          await printBubble(chat, "bot", turn.text);
        }
      }
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

  function scrollChatToBottom() {
    const scroller = document.getElementById("chat-scroll");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  async function printBubble(chat, role, text, opts) {
    opts = opts || {};
    const bubble = document.createElement("div");
    bubble.className = "bubble " + role;
    chat.appendChild(bubble);
    scrollChatToBottom();

    if (opts.instant) {
      bubble.textContent = text;
      scrollChatToBottom();
      return;
    }

    const words = text.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      bubble.textContent = words.slice(0, i + 1).join(" ");
      scrollChatToBottom();
      await sleep(70 + Math.random() * 60);
    }
  }

  // Simulates a plausible fast human typist: character-by-character, quick,
  // with a blinking caret and the occasional brief pause (thinking, or
  // hitting backspace-and-retype) rather than perfectly even spacing.
  async function printBubbleTyped(chat, role, text) {
    const bubble = document.createElement("div");
    bubble.className = "bubble " + role;
    const textSpan = document.createElement("span");
    const caret = document.createElement("span");
    caret.className = "cursor-caret";
    bubble.appendChild(textSpan);
    bubble.appendChild(caret);
    chat.appendChild(bubble);
    scrollChatToBottom();

    for (let i = 0; i < text.length; i++) {
      textSpan.textContent = text.slice(0, i + 1);
      scrollChatToBottom();
      let delay = 16 + Math.random() * 28;
      if (" ,.!?".includes(text[i])) {
        delay += Math.random() * 90;
      }
      await sleep(delay);
    }

    caret.remove();
  }

  async function printSystemNotice(chat, text) {
    const notice = document.createElement("div");
    notice.className = "bubble system-notice";
    notice.textContent = text;
    chat.appendChild(notice);
    scrollChatToBottom();
  }
})();
