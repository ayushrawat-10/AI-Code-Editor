import React, { useState, useRef, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import "./App.css";

const BACKEND_URL = "http://localhost:8000";

// ── Strip markdown fences the model sometimes leaks ─────────────────────────
function cleanSuggestion(raw) {
  return raw
    .replace(/^```[\w]*\n?/gm, "")
    .replace(/^```$/gm, "")
    .trim();
}

// ── Default starter code ─────────────────────────────────────────────────────
const DEFAULT_CODE = `# Welcome to AI Code Editor 🚀
# Start writing Python code below

def greet(name):
    print(f"Hello, {name}!")

greet("World")
`;

// ── Global abort controller so we can cancel in-flight streams ───────────────
let activeAbortController = null;

// ── Stream a suggestion from the backend, calling onToken for each chunk ─────
async function streamSuggestion(code, onToken, onDone, signal) {
  try {
    const response = await fetch(`${BACKEND_URL}/suggest/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal,
    });

    if (!response.ok) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.token) onToken(data.token);
          if (data.done) { onDone(data.full ?? ""); return; }
          if (data.error) { console.warn("Backend error:", data.error); return; }
        } catch {
          // malformed json chunk — ignore
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") console.warn("Stream error:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [isRunning, setIsRunning] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasGhost, setHasGhost] = useState(false);  // for UI badges
  const [terminalLines, setTerminalLines] = useState([
    { type: "info", text: "Terminal ready. Click Run to execute your code." },
  ]);

  const terminalBodyRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const ghostTextRef = useRef("");
  const ghostWidgetRef = useRef(null);   // active Monaco ContentWidget
  const ghostPosRef = useRef(null);      // position where ghost was generated
  const currentCodeRef = useRef(DEFAULT_CODE);
  const sentCodeRef = useRef("");
  const accumulatedRef = useRef("");
  const inlineProviderRef = useRef(null);

  // ── Auto-scroll terminal ──────────────────────────────────────────────────
  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [terminalLines]);

  // NOTE: We intentionally do NOT call editor.trigger("editor.action.inlineSuggest.trigger")
  // here because that dispatches an async Monaco action. Any error inside it bypasses
  // our try-catch and surfaces as an uncaught "Script error". Monaco already calls
  // provideInlineCompletions on every keystroke, so ghost text appears naturally.

  // ── renderGhost — ContentWidget approach (full DOM control, no CSS fights) ─────
  const renderGhost = useCallback((text) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    ghostTextRef.current = text;
    setHasGhost(!!text);

    // Remove old widget first
    if (ghostWidgetRef.current) {
      try { editor?.removeContentWidget(ghostWidgetRef.current); } catch (_e) {}
      ghostWidgetRef.current = null;
    }

    if (!text || !editor || !monaco) return;

    const pos = editor.getPosition();
    if (!pos) return;
    ghostPosRef.current = { lineNumber: pos.lineNumber, column: pos.column };

    // Build the widget DOM — one span per line, <br> between lines
    const node = document.createElement("div");
    node.className = "ghost-content-widget";
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) node.appendChild(document.createElement("br"));
      const span = document.createElement("span");
      span.textContent = line;
      node.appendChild(span);
    });

    const widget = {
      getId: () => "ghost.content.widget",
      getDomNode: () => node,
      getPosition: () => ({
        position: ghostPosRef.current,
        preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
      }),
    };

    editor.addContentWidget(widget);
    ghostWidgetRef.current = widget;
  }, []);

  // ── clearGhost ────────────────────────────────────────────────────────────
  const clearGhost = useCallback(() => {
    ghostTextRef.current = "";
    ghostPosRef.current = null;
    setHasGhost(false);
    if (editorRef.current && ghostWidgetRef.current) {
      try { editorRef.current.removeContentWidget(ghostWidgetRef.current); } catch (_e) {}
      ghostWidgetRef.current = null;
    }
  }, []);

  // ── Cancel any running stream ─────────────────────────────────────────────
  const cancelStream = useCallback(() => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  }, []);

  // ── Dismiss ghost + cancel stream ─────────────────────────────────────────
  const dismiss = useCallback(() => {
    cancelStream();
    clearGhost();
    setIsSyncing(false);
  }, [cancelStream, clearGhost]);

  // ── Accept the current ghost suggestion ──────────────────────────────────
  const acceptSuggestion = useCallback(() => {
    const text = ghostTextRef.current;
    if (!text || !editorRef.current) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    const pos = editor.getPosition();
    if (!model || !pos) return;

    // Clear decorations before inserting so they don't shift
    clearGhost();

    // Insert the suggestion text at the current cursor position
    const eol = model.getEOL();
    editor.executeEdits("ghost-accept", [
      {
        range: {
          startLineNumber: pos.lineNumber,
          startColumn: pos.column,
          endLineNumber: pos.lineNumber,
          endColumn: pos.column,
        },
        text,
        forceMoveMarkers: true,
      },
    ]);

    // Move cursor to end of inserted text
    const insertLines = text.split(eol === "\r\n" ? "\r\n" : "\n");
    const newLineNum = pos.lineNumber + insertLines.length - 1;
    const lastLine = insertLines[insertLines.length - 1];
    const newCol =
      insertLines.length === 1
        ? pos.column + text.length
        : lastLine.length + 1;

    editor.setPosition({ lineNumber: newLineNum, column: newCol });
    editor.focus();

    cancelStream();
    setIsSyncing(false);
  }, [clearGhost, cancelStream]);

  // ── Prefix-match: trim suggestion as user types characters that match it ───
  // Returns the trimmed suggestion still valid for currentCode, or "".
  const matchSuggestion = useCallback((rawSuggestion, sentCode, currentCode) => {
    if (!rawSuggestion) return "";
    // User must have only appended text (not edited middle / deleted)
    if (!currentCode.startsWith(sentCode)) return "";
    const newChars = currentCode.slice(sentCode.length);
    // If no new chars yet, show full suggestion
    if (!newChars) return rawSuggestion;
    // If the new chars ARE the beginning of the suggestion, trim them off
    if (rawSuggestion.startsWith(newChars)) return rawSuggestion.slice(newChars.length);
    // User typed something different — suggestion is incompatible
    return "";
  }, []);

  // ── Apply a suggestion through the prefix-match filter ───────────────────
  const applyGhost = useCallback((raw, sentCode) => {
    const trimmed = matchSuggestion(raw, sentCode, currentCodeRef.current);
    ghostTextRef.current = trimmed;
    setHasGhost(!!trimmed);
    renderGhost(trimmed);
  }, [matchSuggestion, renderGhost]);

  // ── Fetch + stream a suggestion ───────────────────────────────────────────
  const fetchSuggestion = useCallback((currentCode) => {
    cancelStream();           // cancel previous request only when starting fresh
    accumulatedRef.current = "";
    sentCodeRef.current = currentCode;
    setIsSyncing(true);

    const controller = new AbortController();
    activeAbortController = controller;

    streamSuggestion(
      currentCode,
      (token) => {
        accumulatedRef.current += token;
        const cleaned = cleanSuggestion(accumulatedRef.current);
        applyGhost(cleaned, sentCodeRef.current);
      },
      (full) => {
        const cleaned = cleanSuggestion(full || accumulatedRef.current);
        accumulatedRef.current = cleaned;
        applyGhost(cleaned, sentCodeRef.current);
        setIsSyncing(false);
      },
      controller.signal,
    );
  }, [cancelStream, applyGhost]);

  // ── Handle editor text change ─────────────────────────────────────────────
  const handleCodeChange = useCallback((value) => {
    const newCode = value ?? "";
    setCode(newCode);
    currentCodeRef.current = newCode;

    // Re-evaluate the current suggestion via prefix matching.
    // If the user's new chars match the suggestion, it trims live.
    // If not, ghost clears — but we do NOT cancel the stream.
    if (accumulatedRef.current) {
      applyGhost(accumulatedRef.current, sentCodeRef.current);
    }

    // Debounce a fresh request after 300ms of silence
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestion(newCode);
    }, 300);
  }, [applyGhost, fetchSuggestion]);

  // ── Wire up keyboard shortcuts + inline completions provider after mount ────
  const handleEditorMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Register Monaco's native inline completions provider.
      // Monaco calls provideInlineCompletions on every model change (keystroke),
      // which is when ghost text needs to appear anyway.
      const provider = monaco.languages.registerInlineCompletionsProvider(
        { language: "python" },
        {
          provideInlineCompletions(model, position) {
            const ghost = ghostTextRef.current;
            if (!ghost) return { items: [] };
            return {
              items: [{
                insertText: ghost,
                range: new monaco.Range(
                  position.lineNumber, position.column,
                  position.lineNumber, position.column,
                ),
              }],
            };
          },
          freeInlineCompletions() { },
        },
      );
      inlineProviderRef.current = provider;

      // Tab → accept our suggestion (works even if Monaco hasn't shown ghost text yet)
      editor.onKeyDown((e) => {
        if (e.keyCode === monaco.KeyCode.Tab && ghostTextRef.current) {
          e.preventDefault();
          e.stopPropagation();
          acceptSuggestion();
        }
      });

      // Escape → dismiss
      editor.onKeyDown((e) => {
        if (e.keyCode === monaco.KeyCode.Escape && ghostTextRef.current) {
          e.preventDefault();
          dismiss();
        }
      });
    },
    [acceptSuggestion, dismiss],
  );

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    const timerRef = debounceTimerRef;
    return () => {
      cancelStream();
      if (timerRef.current) clearTimeout(timerRef.current);
      inlineProviderRef.current?.dispose();
    };
  }, [cancelStream]);

  // ── Run Code (simulated) ──────────────────────────────────────────────────
  const handleRunCode = () => {
    setIsRunning(true);
    setTerminalLines((prev) => [
      ...prev,
      { type: "prompt", text: "python main.py" },
    ]);
    setTimeout(() => {
      setTerminalLines((prev) => [
        ...prev,
        { type: "success", text: "Your code ran successfully ✓" },
      ]);
      setIsRunning(false);
    }, 800);
  };

  const clearTerminal = () => setTerminalLines([]);

  // ── Monaco editor options ─────────────────────────────────────────────────
  const editorOptions = {
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontLigatures: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: "on",
    renderLineHighlight: "all",
    cursorBlinking: "smooth",
    cursorSmoothCaretAnimation: "on",
    smoothScrolling: true,
    padding: { top: 16, bottom: 16 },
    tabSize: 4,
    wordWrap: "on",
    automaticLayout: true,
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    // Enable Monaco's inline suggest so the provider renders ghost text natively
    inlineSuggest: { enabled: true, mode: "prefix", showToolbar: "never" },
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">

      {/* ── Header / Toolbar ── */}
      <header className="app-header">
        <div className="header-left">
          <div className="app-logo">⚡</div>
          <h1 className="app-title">Code<span>AI</span></h1>
        </div>

        <div className="header-center">
          <div className="tab-item active">
            <div className="tab-dot" />
            main.py
          </div>
        </div>

        <div className="header-right">
          {isSyncing && (
            <span className="ai-thinking-badge">
              <span className="ai-dot" />
              AI thinking…
            </span>
          )}
          {hasGhost && !isSyncing && (
            <span className="ai-ready-badge">
              <span className="ai-ready-dot" />
              Suggestion ready · <kbd>Tab</kbd> to accept
            </span>
          )}
          <span className="lang-badge">Python 3</span>
          <button
            id="run-code-btn"
            className={`run-btn ${isRunning ? "running" : ""}`}
            onClick={handleRunCode}
            disabled={isRunning}
          >
            <span className="run-icon">{isRunning ? "⏳" : "▶"}</span>
            {isRunning ? "Running..." : "Run Code"}
          </button>
        </div>
      </header>

      {/* ── Main Workspace ── */}
      <div className="workspace">

        {/* Activity bar */}
        <nav className="activity-bar" aria-label="Activity Bar">
          <div className="activity-icon active" title="Explorer">📁</div>
          <div className="activity-icon" title="Search">🔍</div>
          <div className="activity-icon" title="AI Suggestions">✨</div>
          <div className="activity-icon" title="Settings">⚙️</div>
        </nav>

        {/* Editor + Terminal */}
        <div className="editor-terminal-pane">

          {/* Editor section */}
          <section className="editor-section">
            <div className="editor-gutter">
              <div className="editor-gutter-left">
                <span className="editor-breadcrumb">
                  workspace / <span className="file-name">main.py</span>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span>{code.split("\n").length} lines</span>
              </div>
            </div>

            <div className="editor-wrapper">
              <Editor
                height="100%"
                defaultLanguage="python"
                theme="vs-dark"
                value={code}
                onChange={handleCodeChange}
                options={editorOptions}
                onMount={handleEditorMount}
              />
            </div>
          </section>

          {/* Terminal section */}
          <section className="terminal-section" aria-label="Output Terminal">
            <div className="terminal-header">
              <div className="terminal-tabs">
                <div className="terminal-tab active">Output</div>
                <div className="terminal-tab">Problems</div>
              </div>
              <div className="terminal-controls">
                <button
                  className="terminal-ctrl-btn"
                  onClick={clearTerminal}
                  title="Clear terminal"
                >
                  🗑
                </button>
              </div>
            </div>

            <div className="terminal-body" ref={terminalBodyRef}>
              {terminalLines.length === 0 ? (
                <div className="terminal-empty">
                  <span className="terminal-cursor" />
                  Ready
                </div>
              ) : (
                terminalLines.map((line, i) =>
                  line.type === "prompt" ? (
                    <div key={i} className="terminal-line">
                      <span className="terminal-prompt">❯</span>
                      <span className="terminal-output">{line.text}</span>
                    </div>
                  ) : (
                    <div key={i} className="terminal-line">
                      <span className={`terminal-output ${line.type}`}>
                        {line.text}
                      </span>
                    </div>
                  )
                )
              )}
              <span className="terminal-cursor" />
            </div>
          </section>
        </div>
      </div>

      {/* ── Status Bar ── */}
      <footer className="status-bar">
        <div className="status-item">⚡ CodeAI</div>
        <div className="status-item">🐍 Python 3</div>
        <div className="status-item">
          {isRunning
            ? "⏳ Running…"
            : isSyncing
              ? "⟳ AI Thinking…"
              : hasGhost
                ? "✦ Suggestion Ready"
                : "✓ Ready"}
        </div>
        <div className="status-right">
          <div className="status-item">Ln {code.split("\n").length}</div>
          <div className="status-item">UTF-8</div>
        </div>
      </footer>
    </div>
  );
}

export default App;