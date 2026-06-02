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

// ── Suffix-prefix overlap matching helper ──────────────────────────────────
function getOverlapLength(linePrefix, suggestion) {
  const maxPossibleOverlap = Math.min(linePrefix.length, suggestion.length);
  for (let len = maxPossibleOverlap; len > 0; len--) {
    const suffix = linePrefix.slice(-len);
    if (suggestion.startsWith(suffix)) {
      return len;
    }
  }
  return 0;
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

// ── Language mapping utilities ────────────────────────────────────────────────
function getLanguageFromExtension(fileName) {
  if (!fileName) return "python";
  const ext = fileName.split(".").pop().toLowerCase();
  switch (ext) {
    case "py": return "python";
    case "cpp":
    case "cc":
    case "cxx":
    case "h":
    case "hpp":
      return "cpp";
    case "c": return "c";
    case "html":
    case "htm":
      return "html";
    case "js":
    case "jsx":
      return "javascript";
    case "css": return "css";
    case "rs": return "rust";
    default: return "python";
  }
}

function getLanguageLabel(fileName) {
  const lang = getLanguageFromExtension(fileName);
  switch (lang) {
    case "python": return "Python 3";
    case "cpp": return "C++";
    case "c": return "C";
    case "html": return "HTML5";
    case "javascript": return "JavaScript";
    case "css": return "CSS3";
    case "rust": return "Rust";
    default: return "Python 3";
  }
}

// ── Stream a suggestion from the backend, calling onToken for each chunk ─────
async function streamSuggestion(code, filename, onToken, onDone, signal) {
  try {
    const response = await fetch(`${BACKEND_URL}/suggest/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, filename }),
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
  const [files, setFiles] = useState({
    "main.py": DEFAULT_CODE
  });
  const [activeFile, setActiveFile] = useState("main.py");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [editingFileName, setEditingFileName] = useState("");
  const [renameInputValue, setRenameInputValue] = useState("");

  const [code, setCode] = useState(DEFAULT_CODE);
  const [isRunning, setIsRunning] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasGhost, setHasGhost] = useState(false);  // for UI badges
  const [terminalLines, setTerminalLines] = useState([
    { type: "info", text: "Terminal ready. Click Run to execute your code." },
  ]);
  const [isTerminalMinimized, setIsTerminalMinimized] = useState(false);

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
  const inlineProviderRef = useRef([]);
  const runAbortControllerRef = useRef(null);
  const isCreatingFileCancelingRef = useRef(false);
  const isRenameCancelingRef = useRef(false);

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

    // Calculate overlap to replace correct range
    const lineContent = model.getLineContent(pos.lineNumber);
    const linePrefix = lineContent.slice(0, pos.column - 1);
    const overlap = getOverlapLength(linePrefix, text);
    const startColumn = pos.column - overlap;

    // Insert/replace suggestion text using correct start column
    const eol = model.getEOL();
    editor.executeEdits("ghost-accept", [
      {
        range: {
          startLineNumber: pos.lineNumber,
          startColumn: startColumn,
          endLineNumber: pos.lineNumber,
          endColumn: pos.column,
        },
        text,
        forceMoveMarkers: true,
      },
    ]);

    // Move cursor precisely to the end of the inserted suggestion
    const insertLines = text.split(eol === "\r\n" ? "\r\n" : "\n");
    const newLineNum = pos.lineNumber + insertLines.length - 1;
    const lastLine = insertLines[insertLines.length - 1];
    const newCol =
      insertLines.length === 1
        ? startColumn + text.length
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
      activeFile,
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
  }, [cancelStream, applyGhost, activeFile]);

  // ── Handle editor text change ─────────────────────────────────────────────
  const handleCodeChange = useCallback((value) => {
    const newCode = value ?? "";
    setCode(newCode);
    currentCodeRef.current = newCode;

    setFiles(prev => ({
      ...prev,
      [activeFile]: newCode
    }));

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
  }, [applyGhost, fetchSuggestion, activeFile]);

  // ── File Explorer callbacks ────────────────────────────────────────────────
  const handleFileSelect = useCallback((fileName) => {
    const currentVal = currentCodeRef.current;
    
    // Atomic state batching to prevent async lag discrepancies
    setFiles(prev => {
      const updated = {
        ...prev,
        [activeFile]: currentVal
      };
      
      const newContent = updated[fileName] ?? "";
      setCode(newContent);
      currentCodeRef.current = newContent;
      return updated;
    });
    
    setActiveFile(fileName);
    clearGhost();
  }, [activeFile, clearGhost]);

  const handleCreateFileSubmit = useCallback(() => {
    setIsCreatingFile(false);
    if (isCreatingFileCancelingRef.current) {
      isCreatingFileCancelingRef.current = false;
      setNewFileName("");
      return;
    }
    const trimmed = newFileName.trim();
    setNewFileName("");
    if (!trimmed) return;
    
    // Prevent duplicates
    if (files[trimmed] !== undefined) {
      alert(`A file named "${trimmed}" already exists.`);
      return;
    }
    
    const currentVal = currentCodeRef.current;
    
    // Atomic file creation and switching inside the state batch
    setFiles(prev => {
      const updated = {
        ...prev,
        [activeFile]: currentVal,
        [trimmed]: ""
      };
      
      setCode("");
      currentCodeRef.current = "";
      return updated;
    });
    
    setActiveFile(trimmed);
    clearGhost();
  }, [activeFile, newFileName, files, clearGhost]);

  const handleNewFileKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      handleCreateFileSubmit();
    } else if (e.key === "Escape") {
      isCreatingFileCancelingRef.current = true;
      setIsCreatingFile(false);
      setNewFileName("");
    }
  }, [handleCreateFileSubmit]);

  const handleRenameStart = useCallback((fileName, e) => {
    e.stopPropagation();
    setEditingFileName(fileName);
    setRenameInputValue(fileName);
  }, []);

  const handleRenameSubmit = useCallback((oldName) => {
    setEditingFileName("");
    if (isRenameCancelingRef.current) {
      isRenameCancelingRef.current = false;
      setRenameInputValue("");
      return;
    }
    
    if (editingFileName !== oldName) return;
    
    const trimmed = renameInputValue.trim();
    if (!trimmed || trimmed === oldName) return;
    
    // Prevent duplicates
    if (files[trimmed] !== undefined) {
      alert(`A file named "${trimmed}" already exists.`);
      return;
    }
    
    setFiles(prev => {
      if (prev[oldName] === undefined) return prev; // Avoid overwriting with undefined
      const updated = { ...prev };
      updated[trimmed] = updated[oldName];
      delete updated[oldName];
      return updated;
    });
    
    if (activeFile === oldName) {
      setActiveFile(trimmed);
    }
  }, [renameInputValue, files, activeFile, editingFileName]);

  const handleRenameKeyDown = useCallback((e, oldName) => {
    if (e.key === "Enter") {
      handleRenameSubmit(oldName);
    } else if (e.key === "Escape") {
      isRenameCancelingRef.current = true;
      setEditingFileName("");
    }
  }, [handleRenameSubmit]);

  const handleDeleteFile = useCallback((fileName, e) => {
    e.stopPropagation();
    
    // Ask for delete confirmation
    const confirmDelete = window.confirm(`Are you sure you want to delete "${fileName}"?`);
    if (!confirmDelete) return;
    
    setFiles(prev => {
      const updated = { ...prev };
      delete updated[fileName];
      
      // Auto switch active file if we deleted the current active file
      if (activeFile === fileName) {
        const remaining = Object.keys(updated);
        if (remaining.length > 0) {
          const nextActive = remaining[0];
          setActiveFile(nextActive);
          setCode(updated[nextActive]);
          currentCodeRef.current = updated[nextActive];
        } else {
          setActiveFile("");
          setCode("");
          currentCodeRef.current = "";
        }
      }
      return updated;
    });
    clearGhost();
  }, [activeFile, clearGhost]);

  const handleDownloadFile = useCallback((fileName, e) => {
    if (e) e.stopPropagation();
    
    let content = files[fileName];
    if (fileName === activeFile) {
      content = currentCodeRef.current;
    }
    
    if (content === undefined) return;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [files, activeFile]);

  // ── Wire up keyboard shortcuts + inline completions provider after mount ────
  const handleEditorMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Register Monaco's native inline completions provider for all supported languages.
      const SUPPORTED_LANGUAGES = ["python", "cpp", "c", "html", "javascript", "css", "rust"];
      const providers = SUPPORTED_LANGUAGES.map(lang => 
        monaco.languages.registerInlineCompletionsProvider(
          { language: lang },
          {
            provideInlineCompletions(model, position) {
              const ghost = ghostTextRef.current;
              if (!ghost) return { items: [] };

              // Calculate overlap range to replace partial text
              const lineContent = model.getLineContent(position.lineNumber);
              const linePrefix = lineContent.slice(0, position.column - 1);
              const overlap = getOverlapLength(linePrefix, ghost);
              const startColumn = position.column - overlap;

              return {
                items: [{
                  insertText: ghost,
                  range: new monaco.Range(
                    position.lineNumber, startColumn,
                    position.lineNumber, position.column,
                  ),
                }],
              };
            },
            freeInlineCompletions() { },
          }
        )
      );
      inlineProviderRef.current = providers;

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
      inlineProviderRef.current?.forEach(p => p.dispose());
    };
  }, [cancelStream]);

  const handleStopCode = useCallback(async () => {
    if (runAbortControllerRef.current) {
      runAbortControllerRef.current.abort();
      runAbortControllerRef.current = null;
    }
    
    // Explicitly send stop request to backend to terminate background subprocess
    try {
      await fetch(`${BACKEND_URL}/execute/stop`, { method: "POST" });
    } catch (err) {
      console.warn("Failed to send stop signal to backend:", err);
    }
  }, []);

  // ── Run Code (Real subprocess execution) ───────────────────────────────────
  const handleRunCode = async () => {
    setIsRunning(true);
    setIsTerminalMinimized(false); // Auto-restore terminal panel to show output
    
    // Determine dynamic terminal command prompt
    const filename = activeFile || "main.py";
    const ext = filename.split(".").pop().toLowerCase();
    let promptText = `python ${filename}`;
    if (ext === "cpp" || ext === "cc" || ext === "cxx") {
      promptText = `g++ ${filename} -o ${filename.replace(/\.[^/.]+$/, "")} && .\\${filename.replace(/\.[^/.]+$/, "")}.exe`;
    } else if (ext === "c") {
      promptText = `gcc ${filename} -o ${filename.replace(/\.[^/.]+$/, "")} && .\\${filename.replace(/\.[^/.]+$/, "")}.exe`;
    } else if (ext === "js") {
      promptText = `node ${filename}`;
    } else if (ext === "rs") {
      promptText = `rustc ${filename} && .\\${filename.replace(/\.[^/.]+$/, "")}.exe`;
    } else if (ext === "html" || ext === "css") {
      promptText = `render ${filename}`;
    }

    setTerminalLines((prev) => [
      ...prev,
      { type: "prompt", text: promptText },
    ]);

    const controller = new AbortController();
    runAbortControllerRef.current = controller;

    try {
      const response = await fetch(`${BACKEND_URL}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, filename }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const newLines = [];

      // Process standard stdout output
      if (data.stdout) {
        const stdoutLines = data.stdout.replace(/\n$/, "").split("\n");
        stdoutLines.forEach((line) => {
          newLines.push({ type: "", text: line });
        });
      }

      // Process standard stderr output
      if (data.stderr) {
        const stderrLines = data.stderr.replace(/\n$/, "").split("\n");
        stderrLines.forEach((line) => {
          newLines.push({ type: "error", text: line });
        });
      }

      // Append final execution success status
      if (data.exit_code === 0) {
        newLines.push({ type: "success", text: "Process finished with exit code 0 ✓" });
      } else {
        newLines.push({ type: "error", text: `Process finished with exit code ${data.exit_code} ✗` });
      }

      setTerminalLines((prev) => [...prev, ...newLines]);
    } catch (err) {
      if (err.name === "AbortError") {
        setTerminalLines((prev) => [
          ...prev,
          { type: "error", text: "KeyboardInterrupt: Process terminated by user (exit code -9) ✗" },
        ]);
      } else {
        setTerminalLines((prev) => [
          ...prev,
          { type: "error", text: `Connection Error: Failed to execute code on backend. (${err.message})` },
        ]);
      }
    } finally {
      if (runAbortControllerRef.current === controller) {
        runAbortControllerRef.current = null;
      }
      setIsRunning(false);
    }
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
    readOnly: !activeFile,
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
          <div className={`tab-item ${activeFile ? "active" : "inactive"}`}>
            {activeFile ? <div className="tab-dot" /> : null}
            {activeFile || "(No file open)"}
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
          <span className="lang-badge">{getLanguageLabel(activeFile)}</span>
          <button
            id="run-code-btn"
            className={`run-btn ${isRunning ? "running" : ""}`}
            onClick={isRunning ? handleStopCode : handleRunCode}
          >
            <span className="run-icon">{isRunning ? "⏹" : "▶"}</span>
            {isRunning ? "Stop" : "Run Code"}
          </button>
        </div>
      </header>

      {/* ── Main Workspace ── */}
      <div className="workspace">

        {/* Activity bar */}
        <nav className="activity-bar" aria-label="Activity Bar">
          <div
            className={`activity-icon ${isSidebarOpen ? "active" : ""}`}
            title="Explorer"
            onClick={() => setIsSidebarOpen(prev => !prev)}
          >
            📁
          </div>
          <div className="activity-icon" title="Search">🔍</div>
          <div className="activity-icon" title="AI Suggestions">✨</div>
          <div className="activity-icon" title="Settings">⚙️</div>
        </nav>

        {/* File Explorer Sidebar */}
        {isSidebarOpen && (
          <div className="sidebar">
            <div className="sidebar-header">
              <span>EXPLORER</span>
              <button
                className="new-file-btn"
                onClick={() => setIsCreatingFile(true)}
                title="New File"
              >
                📄+
              </button>
            </div>
            
            <div className="sidebar-content">
              {isCreatingFile && (
                <div className="new-file-input-wrapper">
                  <span className="file-icon">📄</span>
                  <input
                    type="text"
                    className="new-file-input"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={handleNewFileKeyDown}
                    onBlur={handleCreateFileSubmit}
                    placeholder="file.py"
                    autoFocus
                  />
                </div>
              )}
              
              <div className="file-list">
                {Object.keys(files).map((fileName) => (
                  editingFileName === fileName ? (
                    <div key={fileName} className="file-item rename-mode" onClick={(e) => e.stopPropagation()}>
                      <span className="file-icon">📄</span>
                      <input
                        type="text"
                        className="file-rename-input"
                        value={renameInputValue}
                        onChange={(e) => setRenameInputValue(e.target.value)}
                        onKeyDown={(e) => handleRenameKeyDown(e, fileName)}
                        onBlur={() => handleRenameSubmit(fileName)}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div
                      key={fileName}
                      className={`file-item ${fileName === activeFile ? "active" : ""}`}
                      onClick={() => handleFileSelect(fileName)}
                    >
                      <span className="file-icon">📄</span>
                      <span className="file-name">{fileName}</span>
                      <div className="file-actions">
                        <button
                          className="file-action-btn rename"
                          onClick={(e) => handleRenameStart(fileName, e)}
                          title="Rename File"
                        >
                          ✏️
                        </button>
                        <button
                          className="file-action-btn download"
                          onClick={(e) => handleDownloadFile(fileName, e)}
                          title="Download File"
                        >
                          📥
                        </button>
                        <button
                          className="file-action-btn delete"
                          onClick={(e) => handleDeleteFile(fileName, e)}
                          title="Delete File"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Editor + Terminal */}
        <div className="editor-terminal-pane">

          {/* Editor section */}
          <section className="editor-section">
            <div className="editor-gutter">
              <div className="editor-gutter-left">
                <span className="editor-breadcrumb">
                  workspace / <span className="file-name">{activeFile || "(no file open)"}</span>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span>{activeFile ? code.split("\n").length : 0} lines</span>
                {activeFile && (
                  <button
                    className="editor-download-btn"
                    onClick={(e) => handleDownloadFile(activeFile, e)}
                    title="Download Current File"
                  >
                    📥 Download
                  </button>
                )}
              </div>
            </div>

            <div className="editor-wrapper">
              <Editor
                height="100%"
                language={activeFile ? getLanguageFromExtension(activeFile) : "python"}
                theme="vs-dark"
                value={activeFile ? code : "# Create or select a file in the Explorer Sidebar to begin coding ⚡"}
                onChange={handleCodeChange}
                options={editorOptions}
                onMount={handleEditorMount}
              />
            </div>
          </section>

          {/* Terminal section */}
          <section className={`terminal-section ${isTerminalMinimized ? "minimized" : ""}`} aria-label="Output Terminal">
            <div className="terminal-header">
              <div className="terminal-tabs" onClick={() => setIsTerminalMinimized(prev => !prev)} style={{ cursor: "pointer" }}>
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
                <button
                  className="terminal-ctrl-btn toggle-btn"
                  onClick={() => setIsTerminalMinimized(prev => !prev)}
                  title={isTerminalMinimized ? "Restore terminal" : "Minimize terminal"}
                  style={{ marginLeft: 8 }}
                >
                  {isTerminalMinimized ? "▲" : "▼"}
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