import React, { useState, useRef, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import "./App.css";

const BACKEND_URL = "http://localhost:8000";
const SUGGEST_DEBOUNCE_MS = 1500; // send to backend 1.5s after user stops typing

// Strip residual markdown fences the model sometimes returns
function cleanSuggestion(raw) {
  return raw
    .replace(/^```[\w]*\n?/m, "")
    .replace(/```$/m, "")
    .trim();
}

// Default Python starter code
const DEFAULT_CODE = `# Welcome to AI Code Editor 🚀
# Start writing Python code below

def greet(name):
    print(f"Hello, {name}!")

greet("World")
`;

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [isRunning, setIsRunning] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);   // true while waiting for /suggest
  const [suggestion, setSuggestion] = useState("");     // latest AI suggestion
  const [terminalLines, setTerminalLines] = useState([
    { type: "info", text: "Terminal ready. Click Run to execute your code." },
  ]);
  const terminalBodyRef = useRef(null);
  const debounceTimer = useRef(null);
  const editorRef = useRef(null);

  // ── Auto-scroll terminal ──
  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [terminalLines]);

  // ── Send code to backend and store the AI suggestion ──
  const sendToBackend = useCallback(async (currentCode) => {
    setSuggestion("");   // clear old suggestion while loading
    setIsSyncing(true);
    try {
      const res = await fetch(`${BACKEND_URL}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: currentCode }),
      });
      if (res.ok) {
        const data = await res.json();
        const clean = cleanSuggestion(data.suggestion ?? "");
        if (clean) setSuggestion(clean);
      }
    } catch {
      // Backend might not be running yet; fail silently
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // ── Accept suggestion: append it to current code ──
  const acceptSuggestion = useCallback(() => {
    if (!suggestion) return;
    setCode((prev) => {
      const separator = prev.endsWith("\n") ? "" : "\n";
      return prev + separator + suggestion;
    });
    setSuggestion("");
  }, [suggestion]);

  // ── Tab key in editor accepts the suggestion ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Tab" && suggestion) {
        e.preventDefault();
        acceptSuggestion();
      }
      if (e.key === "Escape") setSuggestion("");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [suggestion, acceptSuggestion]);

  const handleCodeChange = (value) => {
    const newCode = value ?? "";
    setCode(newCode);
    setSuggestion("");  // clear stale suggestion on new keystrokes

    // Reset debounce timer on every keystroke
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      sendToBackend(newCode);
    }, SUGGEST_DEBOUNCE_MS);
  };

  const clearTerminal = () => {
    setTerminalLines([]);
  };

  const handleRunCode = () => {
    setIsRunning(true);

    // Append the "run" command prompt line
    setTerminalLines((prev) => [
      ...prev,
      { type: "prompt", text: "python main.py" },
    ]);

    // Simulate a short execution delay
    setTimeout(() => {
      setTerminalLines((prev) => [
        ...prev,
        { type: "success", text: "Your code ran successfully ✓" },
      ]);
      setIsRunning(false);
    }, 800);
  };

  // Monaco editor options
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
  };

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

        {/* Editor + Terminal (stacked vertically) */}
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
                {isSyncing && (
                  <span className="ai-thinking-badge">
                    <span className="ai-dot" />
                    AI thinking…
                  </span>
                )}
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
                onMount={(editor) => { editorRef.current = editor; }}
              />
            </div>

            {/* ── AI Suggestion Panel ── */}
            {(suggestion || isSyncing) && (
              <div className="ai-suggestion-panel" role="complementary" aria-label="AI Suggestion">
                <div className="ai-panel-header">
                  <span className="ai-panel-title">
                    <span className="ai-sparkle">✦</span> AI Suggestion
                  </span>
                  <div className="ai-panel-actions">
                    {suggestion && (
                      <>
                        <button
                          id="accept-suggestion-btn"
                          className="ai-accept-btn"
                          onClick={acceptSuggestion}
                          title="Accept (Tab)"
                        >
                          Accept <kbd>Tab</kbd>
                        </button>
                        <button
                          id="dismiss-suggestion-btn"
                          className="ai-dismiss-btn"
                          onClick={() => setSuggestion("")}
                          title="Dismiss (Esc)"
                        >
                          Dismiss <kbd>Esc</kbd>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="ai-panel-body">
                  {isSyncing && !suggestion ? (
                    <div className="ai-loading">
                      <span className="ai-shimmer" />
                      <span className="ai-shimmer short" />
                    </div>
                  ) : (
                    <pre className="ai-code-preview">{suggestion}</pre>
                  )}
                </div>
              </div>
            )}
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
              {/* Blinking cursor at end */}
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
          {isRunning ? "⏳ Running…" : isSyncing ? "⟳ Syncing…" : "✓ Ready"}
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