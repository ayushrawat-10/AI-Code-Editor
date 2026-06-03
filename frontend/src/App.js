import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Editor from "@monaco-editor/react";
import "./App.css";
import { buildFileTree, getSortedChildren, getAllFolderPaths, getBaseName } from "./fileTree";
import {
  IconFiles,
  IconSparkles,
  IconSettings,
  IconPlay,
  IconStop,
  IconClose,
  IconNewFile,
  IconRefresh,
  IconChevronRight,
  IconChevronDown,
  IconFolder,
} from "./icons";

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
const DEFAULT_CODE = `# Welcome — start writing Python below

def greet(name):
    print(f"Hello, {name}!")

greet("World")
`;

function CopyButton({ code, onCopy }) {
  const [copied, setCopied] = React.useState(false);
  const handleClick = () => {
    onCopy(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button type="button" className={`chat-code-copy ${copied ? "copied" : ""}`} onClick={handleClick}>
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
      )}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ── Inline markdown → React nodes (bold, italic, inline-code) ─────────────────
function parseInline(text, baseKey) {
  // Tokens: **bold**, *italic*, `code`
  const pattern = /(`[^`]+`|\*\*[\s\S]+?\*\*|\*[^*]+\*)/g;
  const parts = [];
  let last = 0;
  let match;
  let idx = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<React.Fragment key={`${baseKey}-t${idx++}`}>{text.slice(last, match.index)}</React.Fragment>);
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${baseKey}-b${idx++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={`${baseKey}-c${idx++}`} className="md-inline-code">{token.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={`${baseKey}-i${idx++}`}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    parts.push(<React.Fragment key={`${baseKey}-t${idx++}`}>{text.slice(last)}</React.Fragment>);
  }
  return parts;
}

// ── Block markdown renderer (headings, lists, paragraphs, hr) ─────────────────
function renderMarkdownBlock(text, blockKey, onCopyCode) {
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip blank lines
    if (!trimmed) { i++; continue; }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(<hr key={`${blockKey}-hr-${i}`} className="md-hr" />);
      i++; continue;
    }

    // ATX Headings  # ## ###
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = `h${level + 2}`; // h3, h4, h5 so they stay subordinate to page h1
      elements.push(
        <Tag key={`${blockKey}-h-${i}`} className={`md-heading md-h${level}`}>
          {parseInline(headingMatch[2], `${blockKey}-h-${i}`)}
        </Tag>
      );
      i++; continue;
    }

    // Ordered list  1. item
    if (/^\d+\.\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+\.\s/, "");
        items.push(<li key={`${blockKey}-li-${i}`}>{parseInline(content, `${blockKey}-li-${i}`)}</li>);
        i++;
      }
      elements.push(<ol key={`${blockKey}-ol-${i}`} className="md-list md-ol">{items}</ol>);
      continue;
    }

    // Unordered list  - item  or  * item
    if (/^[-*]\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*]\s/, "");
        items.push(<li key={`${blockKey}-li-${i}`}>{parseInline(content, `${blockKey}-li-${i}`)}</li>);
        i++;
      }
      elements.push(<ul key={`${blockKey}-ul-${i}`} className="md-list md-ul">{items}</ul>);
      continue;
    }

    // Plain paragraph
    elements.push(
      <p key={`${blockKey}-p-${i}`} className="md-p">
        {parseInline(trimmed, `${blockKey}-p-${i}`)}
      </p>
    );
    i++;
  }

  return elements;
}

// ── Top-level renderer: splits on fenced code blocks first ───────────────────
function renderMessageContent(content, onCopyCode) {
  const parts = content.split(/(```[\w]*\n[\s\S]*?```)/g);
  return parts.map((part, i) => {
    const fence = part.match(/^```(\w*)\n([\s\S]*)```$/);
    if (fence) {
      const lang = fence[1] || "code";
      const code = fence[2].replace(/\n$/, "");
      return (
        <div key={i} className="chat-code-block">
          <div className="chat-code-header">
            <div className="chat-code-header-left">
              <span className="chat-code-dot" />
              <span className="chat-code-dot" />
              <span className="chat-code-dot" />
              <span className="chat-code-lang">{lang}</span>
            </div>
            <CopyButton code={code} onCopy={onCopyCode} />
          </div>
          <pre className="chat-code-pre"><code>{code}</code></pre>
        </div>
      );
    }
    if (!part.trim()) return null;
    return (
      <div key={i} className="chat-text-block">
        {renderMarkdownBlock(part, `block-${i}`, onCopyCode)}
      </div>
    );
  });
}

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

function getLanguageFileIcon(fileName) {
  if (!fileName) return <span className="file-lang-icon default">··</span>;
  const ext = fileName.split(".").pop().toLowerCase();
  switch (ext) {
    case "html":
    case "htm":
      return <span className="file-lang-icon html">&lt;&gt;</span>;
    case "css":
      return <span className="file-lang-icon css">#</span>;
    case "js":
    case "jsx":
      return <span className="file-lang-icon js">JS</span>;
    case "py":
      return <span className="file-lang-icon python">PY</span>;
    case "rs":
      return <span className="file-lang-icon rust">RS</span>;
    case "cpp":
    case "cc":
    case "cxx":
      return <span className="file-lang-icon cpp">C++</span>;
    case "c":
      return <span className="file-lang-icon c-lang">C</span>;
    case "md":
      return <span className="file-lang-icon md">ℹ</span>;
    default:
      return <span className="file-lang-icon default">··</span>;
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
  const [openTabs, setOpenTabs] = useState(["main.py"]);
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
    { type: "info", text: "Ready. Press Run or F5 to execute the active file." },
  ]);
  const [isTerminalMinimized, setIsTerminalMinimized] = useState(false);
  const [panelTab, setPanelTab] = useState("terminal");
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());

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

  const [terminalHeight, setTerminalHeight] = useState(200);
  const [isDraggingTerminal, setIsDraggingTerminal] = useState(false);

  // Sidebar and assistant panel horizontal resize
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [assistantWidth, setAssistantWidth] = useState(360);
  const [isDraggingAssistant, setIsDraggingAssistant] = useState(false);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      content:
        "Ask about your open file, or use Explain / Fix / Docs above. Inline completions appear as you type — press Tab to accept.",
    },
  ]);
  const [chatInputValue, setChatInputValue] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatBodyRef = useRef(null);

  // Auto-scroll chat body
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

  const filePaths = useMemo(() => Object.keys(files).sort(), [files]);
  const fileTree = useMemo(() => buildFileTree(filePaths), [filePaths]);

  useEffect(() => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      getAllFolderPaths(filePaths).forEach((p) => next.add(p));
      return next;
    });
  }, [filePaths]);

  const handleResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDraggingTerminal(true);
  }, []);

  useEffect(() => {
    if (!isDraggingTerminal) {
      document.body.classList.remove("dragging-panel-active");
      return;
    }

    document.body.classList.add("dragging-panel-active");

    const handleMouseMove = (e) => {
      const newHeight = window.innerHeight - e.clientY;
      const minHeight = 100;
      const maxHeight = window.innerHeight * 0.7;
      if (newHeight >= minHeight && newHeight <= maxHeight) {
        setTerminalHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingTerminal(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.classList.remove("dragging-panel-active");
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingTerminal]);

  // ── Sidebar horizontal resize ─────────────────────────────────────────────
  const handleSidebarResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
  }, []);

  useEffect(() => {
    if (!isDraggingSidebar) {
      document.body.classList.remove("dragging-col-active");
      return;
    }
    document.body.classList.add("dragging-col-active");
    const handleMouseMove = (e) => {
      // sidebar starts right after the activity bar (48 px)
      const newWidth = e.clientX - 48;
      const min = 160;
      const max = window.innerWidth * 0.4;
      if (newWidth >= min && newWidth <= max) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsDraggingSidebar(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.classList.remove("dragging-col-active");
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingSidebar]);

  // ── Assistant panel horizontal resize ────────────────────────────────────
  const handleAssistantResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDraggingAssistant(true);
  }, []);

  useEffect(() => {
    if (!isDraggingAssistant) {
      document.body.classList.remove("dragging-col-active");
      return;
    }
    document.body.classList.add("dragging-col-active");
    const handleMouseMove = (e) => {
      // assistant panel right-aligns: width = window right edge - mouse X
      const newWidth = window.innerWidth - e.clientX;
      const min = 260;
      const max = window.innerWidth * 0.5;
      if (newWidth >= min && newWidth <= max) setAssistantWidth(newWidth);
    };
    const handleMouseUp = () => setIsDraggingAssistant(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.classList.remove("dragging-col-active");
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingAssistant]);

  const handleSaveFile = useCallback(() => {
    if (!activeFile) return;
    setTerminalLines(prev => [
      ...prev,
      { type: "success", text: `✓ [System] saved '${activeFile}' successfully to browser in-memory session.` }
    ]);
  }, [activeFile]);

  const handleShareFile = useCallback(() => {
    if (!activeFile) return;
    const shareCode = currentCodeRef.current;
    navigator.clipboard.writeText(shareCode).then(() => {
      setTerminalLines(prev => [
        ...prev,
        { type: "info", text: `→ [Link] Code snippet for '${activeFile}' copied to clipboard!` }
      ]);
    }).catch(err => {
      setTerminalLines(prev => [
        ...prev,
        { type: "error", text: `✗ Failed to copy shareable link: ${err.message}` }
      ]);
    });
  }, [activeFile]);

  const handleSendChatMessage = useCallback(async (e, overrideMessage, displayMessage) => {
    if (e) e.preventDefault();
    const query = (overrideMessage ?? chatInputValue).trim();
    if (!query || isChatLoading) return;

    // What we SHOW in the chat bubble (short label for quick actions, full text for typed input)
    const visibleText = displayMessage ?? query;

    setChatMessages((prev) => [...prev, { role: "user", content: visibleText, isQuickAction: !!displayMessage }]);
    setChatInputValue("");
    setIsChatLoading(true);

    let hasStartedAssistantMessage = false;

    try {
      const response = await fetch(`${BACKEND_URL}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,          // full prompt with code goes to backend
          code: currentCodeRef.current,
          filename: activeFile || "main.py"
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

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
            if (data.token) {
              if (!hasStartedAssistantMessage) {
                // First token received! Turn off loading dots, start assistant message
                setIsChatLoading(false);
                hasStartedAssistantMessage = true;
                setChatMessages(prev => [...prev, { role: "assistant", content: data.token }]);
              } else {
                // Append subsequent tokens to the last assistant message
                setChatMessages(prev => {
                  if (prev.length === 0) return prev;
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + data.token
                    };
                  }
                  return updated;
                });
              }
            }
            if (data.done) {
              return;
            }
            if (data.error) {
              // Backend sent a structured error event — show a friendly in-chat message
              const friendly = data.user_message || "Response generation failed. Please try again.";
              setIsChatLoading(false);
              if (!hasStartedAssistantMessage) {
                setChatMessages(prev => [...prev, { role: "error", content: friendly }]);
              } else {
                // A partial response was already shown — append a note so it's clear it's incomplete
                setChatMessages(prev => {
                  if (prev.length === 0) return prev;
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === "assistant") {
                    updated[updated.length - 1] = { ...last, truncated: true };
                  }
                  return [...updated, { role: "error", content: friendly }];
                });
              }
              return;
            }
          } catch (jsonErr) {
            // ignore malformed lines
          }
        }
      }
    } catch (err) {
      console.error("Chat stream error:", err);
      setIsChatLoading(false);
      const friendly = "Connection error — could not reach the AI. Please check the backend and try again.";
      if (hasStartedAssistantMessage) {
        // Mark the last partial message as truncated, then add an error bubble
        setChatMessages(prev => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            updated[updated.length - 1] = { ...last, truncated: true };
          }
          return [...updated, { role: "error", content: friendly }];
        });
      } else {
        setChatMessages(prev => [...prev, { role: "error", content: friendly }]);
      }
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInputValue, isChatLoading, activeFile]);

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

    setFiles((prev) => {
      const updated = { ...prev, [activeFile]: currentVal };
      const newContent = updated[fileName] ?? "";
      setCode(newContent);
      currentCodeRef.current = newContent;
      return updated;
    });

    setActiveFile(fileName);
    setOpenTabs((prev) => (prev.includes(fileName) ? prev : [...prev, fileName]));
    clearGhost();
  }, [activeFile, clearGhost]);

  const handleCloseTab = useCallback(
    (fileName, e) => {
      e.stopPropagation();
      setOpenTabs((prev) => {
        const idx = prev.indexOf(fileName);
        const next = prev.filter((f) => f !== fileName);
        if (activeFile === fileName && next.length > 0) {
          const newActive = next[Math.min(idx, next.length - 1)];
          handleFileSelect(newActive);
        } else if (activeFile === fileName && next.length === 0) {
          setActiveFile("");
          setCode("");
          currentCodeRef.current = "";
        }
        return next;
      });
    },
    [activeFile, handleFileSelect],
  );

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
    setOpenTabs((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
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
    
    if (activeFile === oldName) setActiveFile(trimmed);
    setOpenTabs((prev) => prev.map((f) => (f === oldName ? trimmed : f)));
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
    
    setFiles((prev) => {
      const updated = { ...prev };
      delete updated[fileName];
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
    setOpenTabs((prev) => prev.filter((f) => f !== fileName));
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

      monaco.editor.defineTheme("workbench-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#1e1e1e",
          "editor.lineHighlightBackground": "#2a2d2e",
          "editorGutter.background": "#1e1e1e",
          "editor.selectionBackground": "#264f78",
          "editor.inactiveSelectionBackground": "#3a3d41",
        },
      });
      monaco.editor.setTheme("workbench-dark");

      editor.onDidChangeCursorPosition((e) => {
        setCursorPosition({
          line: e.position.lineNumber,
          column: e.position.column,
        });
      });

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

  const runCodeRef = useRef(handleRunCode);
  const stopCodeRef = useRef(handleStopCode);
  runCodeRef.current = handleRunCode;
  stopCodeRef.current = handleStopCode;

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "F5") {
        e.preventDefault();
        if (isRunning) stopCodeRef.current();
        else if (activeFile) runCodeRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isRunning, activeFile]);

  const handleCopyCode = useCallback((text) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const handleQuickAction = useCallback(
    (label, prompt) => {
      setIsChatOpen(true);
      // label = short text shown in chat bubble
      // prompt = full instruction + code sent to the backend
      handleSendChatMessage(null, prompt, label);
    },
    [handleSendChatMessage],
  );

  const toggleFolder = useCallback((folderPath) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

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
    padding: { top: 8, bottom: 8 },
    tabSize: 2,
    wordWrap: "on",
    automaticLayout: true,
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    // Enable Monaco's inline suggest so the provider renders ghost text natively
    inlineSuggest: { enabled: true, mode: "prefix", showToolbar: "never" },
    readOnly: !activeFile,
  };

  const statusMessage = isRunning
    ? "Running…"
    : isSyncing
      ? "AI suggesting…"
      : hasGhost
        ? "Suggestion ready — Tab to accept"
        : "Ready";

  const renderFileItem = (fileName, depth = 0) => {
    const isActive = fileName === activeFile;
    const pad = depth * 12 + 24;
    if (editingFileName === fileName) {
      return (
        <div
          key={fileName}
          className="file-item rename-mode"
          style={{ paddingLeft: pad }}
          onClick={(e) => e.stopPropagation()}
        >
          {getLanguageFileIcon(fileName)}
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
      );
    }
    return (
      <div
        key={fileName}
        className={`file-item ${isActive ? "active" : ""}`}
        style={{ paddingLeft: pad }}
        onClick={() => handleFileSelect(fileName)}
      >
        <span className="tree-caret" aria-hidden />
        {getLanguageFileIcon(fileName)}
        <span className="file-name" title={fileName}>
          {getBaseName(fileName)}
        </span>
        <div className="file-actions">
          <button
            type="button"
            className="file-action-btn"
            onClick={(e) => handleRenameStart(fileName, e)}
            title="Rename"
          >
            Ren
          </button>
          <button
            type="button"
            className="file-action-btn"
            onClick={(e) => handleDownloadFile(fileName, e)}
            title="Download"
          >
            Dl
          </button>
          <button
            type="button"
            className="file-action-btn danger"
            onClick={(e) => handleDeleteFile(fileName, e)}
            title="Delete"
          >
            Del
          </button>
        </div>
      </div>
    );
  };

  const renderExplorerNodes = (folderNode, depth = 0) =>
    getSortedChildren(folderNode).map((node) => {
      if (node.type === "folder") {
        const expanded = expandedFolders.has(node.fullPath);
        return (
          <React.Fragment key={`dir-${node.fullPath}`}>
            <div
              className="tree-folder-row"
              style={{ paddingLeft: depth * 12 + 8 }}
              onClick={() => toggleFolder(node.fullPath)}
            >
              <span className="tree-caret">
                {expanded ? <IconChevronDown /> : <IconChevronRight />}
              </span>
              <span className="tree-folder-icon">
                <IconFolder />
              </span>
              <span className="file-name">{node.name}</span>
            </div>
            {expanded && renderExplorerNodes(node, depth + 1)}
          </React.Fragment>
        );
      }
      return renderFileItem(node.fullPath, depth);
    });

  return (
    <div className="app-shell">

      <header className="titlebar">
        <div className="titlebar-left">
          <span className="app-brand">CodeLab</span>
          <nav className="titlebar-menu" aria-label="Main menu">
            <button type="button" className="menu-item" onClick={handleSaveFile} title="Save file">
              File
            </button>
            <button
              type="button"
              className="menu-item menu-item--run"
              onClick={isRunning ? handleStopCode : handleRunCode}
              title={isRunning ? "Stop (F5)" : "Run (F5)"}
            >
              {isRunning ? "Stop" : "Run"}
            </button>
            <button type="button" className="menu-item" onClick={handleShareFile} title="Copy code to clipboard">
              Share
            </button>
          </nav>
        </div>
        <div className="titlebar-right">
          <button
            type="button"
            id="run-code-btn"
            className={`titlebar-btn primary-run ${isRunning ? "running" : ""}`}
            onClick={isRunning ? handleStopCode : handleRunCode}
            title={isRunning ? "Stop (F5)" : "Run (F5)"}
            aria-pressed={isRunning}
          >
            {isRunning ? <IconStop /> : <IconPlay />}
            {isRunning ? "Stop" : "Run"}
          </button>
          <button
            type="button"
            className={`titlebar-btn titlebar-btn--assist ${isChatOpen ? "active" : ""}`}
            onClick={() => setIsChatOpen((prev) => !prev)}
            title="Toggle AI Assistant"
            aria-pressed={isChatOpen}
          >
            <IconSparkles />
            Assistant
          </button>
        </div>
      </header>

      <div className="workspace">
        <nav className="activity-bar" aria-label="Activity Bar">
          <button
            type="button"
            className={`activity-btn ${isSidebarOpen ? "active" : ""}`}
            title="Explorer"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            aria-pressed={isSidebarOpen}
          >
            <IconFiles />
          </button>
          <button
            type="button"
            className={`activity-btn activity-btn--assist ${isChatOpen ? "active" : ""}`}
            title="AI Assistant"
            onClick={() => setIsChatOpen((prev) => !prev)}
            aria-pressed={isChatOpen}
          >
            <IconSparkles />
          </button>
          <div className="activity-bar-bottom">
            <button
              type="button"
              className="activity-btn"
              title="Settings"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
            >
              <IconSettings />
            </button>
          </div>
        </nav>

        {isSidebarOpen && (
          <aside
            className="sidebar"
            style={{ width: sidebarWidth, minWidth: sidebarWidth }}
          >
            {/* Right-edge resizer */}
            <div
              className={`sidebar-resizer ${isDraggingSidebar ? "dragging" : ""}`}
              onMouseDown={handleSidebarResizerMouseDown}
              title="Drag to resize"
            />
            <div className="sidebar-header">
              <span className="sidebar-title">Explorer</span>
              <div className="sidebar-tools">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setIsCreatingFile(true)}
                  title="New file (use paths like src/app.py)"
                >
                  <IconNewFile />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setIsCreatingFile(true)}
                  title="New file in folder — type path in name"
                >
                  <IconFolder />
                </button>
                <button type="button" className="icon-btn" title="Refresh" onClick={clearGhost}>
                  <IconRefresh />
                </button>
              </div>
            </div>
            <div className="sidebar-content">
              {isCreatingFile && (
                <div className="new-file-input-wrapper">
                  <input
                    type="text"
                    className="new-file-input"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={handleNewFileKeyDown}
                    onBlur={handleCreateFileSubmit}
                    placeholder="main.py or src/app.py"
                    autoFocus
                  />
                </div>
              )}
              <div className="explorer-tree">
                {filePaths.length === 0 ? (
                  <p className="empty-tree-hint">No files. Create one with +</p>
                ) : (
                  renderExplorerNodes(fileTree)
                )}
              </div>
            </div>
          </aside>
        )}

        <div className="editor-terminal-pane">
          <section className="editor-section">
            {openTabs.length > 0 ? (
              <div className="editor-tabs" role="tablist">
                {openTabs.map((tabPath) => (
                  <button
                    key={tabPath}
                    type="button"
                    role="tab"
                    className={`editor-tab ${tabPath === activeFile ? "active" : ""}`}
                    onClick={() => handleFileSelect(tabPath)}
                    title={tabPath}
                  >
                    {getLanguageFileIcon(tabPath)}
                    <span className="editor-tab-label">{getBaseName(tabPath)}</span>
                    <span className="editor-tab-dirty" aria-hidden />
                    <span
                      className="editor-tab-close"
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => handleCloseTab(tabPath, e)}
                      title="Close"
                    >
                      <IconClose />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="editor-tabs-empty">Open a file from the explorer</div>
            )}

            <div className="editor-wrapper">
              <Editor
                height="100%"
                language={activeFile ? getLanguageFromExtension(activeFile) : "python"}
                theme="vs-dark"
                value={
                  activeFile
                    ? code
                    : "// Select or create a file in the explorer to start editing"
                }
                onChange={handleCodeChange}
                options={editorOptions}
                onMount={handleEditorMount}
              />
            </div>
          </section>

          <section
            className={`panel-section ${isTerminalMinimized ? "minimized" : ""} ${isDraggingTerminal ? "dragging" : ""}`}
            style={{ height: isTerminalMinimized ? undefined : `${terminalHeight}px` }}
            aria-label="Panel"
          >
            <div
              className="panel-resizer"
              onMouseDown={handleResizerMouseDown}
              title="Drag to resize"
            />
            <div className="panel-header">
              <div className="panel-tabs">
                <button
                  type="button"
                  className={`panel-tab ${panelTab === "terminal" ? "active" : ""}`}
                  onClick={() => setPanelTab("terminal")}
                >
                  Terminal
                </button>
                <button type="button" className="panel-tab" disabled title="Coming soon">
                  Problems
                </button>
              </div>
              <div className="panel-controls">
                <button type="button" className="panel-ctrl-btn" onClick={clearTerminal}>
                  Clear
                </button>
                <button
                  type="button"
                  className="panel-ctrl-btn"
                  onClick={() => setIsTerminalMinimized((prev) => !prev)}
                >
                  {isTerminalMinimized ? "Expand" : "Collapse"}
                </button>
              </div>
            </div>
            {!isTerminalMinimized && (
              <div className="terminal-body" ref={terminalBodyRef}>
                {terminalLines.length === 0 ? (
                  <div className="terminal-empty">Waiting for output…</div>
                ) : (
                  terminalLines.map((line, i) =>
                    line.type === "prompt" ? (
                      <div key={i} className="terminal-line">
                        <span className="terminal-prompt">$</span>
                        <span className="terminal-output">{line.text}</span>
                      </div>
                    ) : (
                      <div key={i} className="terminal-line">
                        <span className={`terminal-output ${line.type}`}>{line.text}</span>
                      </div>
                    ),
                  )
                )}
              </div>
            )}
          </section>
        </div>

        {isChatOpen && (
          <aside
            className="assistant-panel"
            style={{ width: assistantWidth, minWidth: assistantWidth }}
          >
            {/* Left-edge resizer */}
            <div
              className={`assistant-resizer ${isDraggingAssistant ? "dragging" : ""}`}
              onMouseDown={handleAssistantResizerMouseDown}
              title="Drag to resize"
            />
            {/* ── Header ── */}
            <div className="assistant-header">
              <div className="assistant-header-info">
                <div className="assistant-avatar-sm">
                  <IconSparkles />
                </div>
                <div>
                  <span className="assistant-title">AI Assistant</span>
                  <span className="assistant-status-dot" />
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setIsChatOpen(false)}
                title="Close"
              >
                <IconClose />
              </button>
            </div>

            {/* ── Quick action chips ── */}
            <div className="assistant-quick-actions">
              <button
                type="button"
                className="quick-action-btn"
                disabled={isChatLoading}
                onClick={() =>
                  handleQuickAction(
                    `Explain ‘${activeFile || "this file"}’`,
                    `Explain the following code clearly and concisely. Describe what it does, how it works, and any key patterns used:\n\n${currentCodeRef.current}`,
                  )
                }
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>
                Explain
              </button>
              <button
                type="button"
                className="quick-action-btn"
                disabled={isChatLoading}
                onClick={() =>
                  handleQuickAction(
                    `Fix bugs in ‘${activeFile || "this file"}’`,
                    `Find all bugs and issues in the following code and return the corrected version with a brief explanation of each fix:\n\n${currentCodeRef.current}`,
                  )
                }
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM11.189 6.25 9.75 4.81l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.249.249 0 0 0 .108-.064l6.286-6.286Z"/></svg>
                Fix
              </button>
              <button
                type="button"
                className="quick-action-btn"
                disabled={isChatLoading}
                onClick={() =>
                  handleQuickAction(
                    `Generate docs for ‘${activeFile || "this file"}’`,
                    `Generate complete documentation for the following code. Add docstrings to all functions/classes and inline comments for non-obvious logic:\n\n${currentCodeRef.current}`,
                  )
                }
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Z"/></svg>
                Docs
              </button>
            </div>

            {/* ── Message list ── */}
            <div className="assistant-messages" ref={chatBodyRef}>
              {chatMessages.map((msg, i) => (
                msg.role === "user" ? (
                  <div key={i} className="chat-row chat-row--user">
                    <div className="chat-bubble chat-bubble--user">
                      {msg.isQuickAction && (
                        <div className="chat-quick-action-badge">
                          <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M9.504.43a1.516 1.516 0 0 1 2.437 1.713L9.232 6h2.686a1 1 0 0 1 .896 1.45l-3.28 7.5a1.516 1.516 0 0 1-2.821-1.04l1.34-4.01H4.756a1 1 0 0 1-.897-1.45l3.527-7.5a1.516 1.516 0 0 1 2.118-.52Z"/>
                          </svg>
                          Quick action
                        </div>
                      )}
                      <div className="chat-bubble-text">{msg.content}</div>
                    </div>
                  </div>
                ) : msg.role === "error" ? (
                  <div key={i} className="chat-row chat-row--system">
                    <div className="chat-error-bubble">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style={{flexShrink:0}}>
                        <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>
                      </svg>
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="chat-row chat-row--ai">
                    <div className="chat-avatar">
                      <IconSparkles />
                    </div>
                    <div className="chat-bubble chat-bubble--ai">
                      {renderMessageContent(msg.content, handleCopyCode)}
                      {msg.truncated && (
                        <div className="chat-truncated-badge">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l1.378 2.757a.75.75 0 0 1-1.356.638l-1.5-3A.75.75 0 0 1 7 7.75V4.75a.75.75 0 0 1 1.5 0Z"/>
                          </svg>
                          Response may be incomplete
                        </div>
                      )}
                    </div>
                  </div>
                )
              ))}
              {isChatLoading && (
                <div className="chat-row chat-row--ai">
                  <div className="chat-avatar">
                    <IconSparkles />
                  </div>
                  <div className="chat-bubble chat-bubble--ai chat-bubble--loading">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}
            </div>

            {/* ── Input area ── */}
            <form className="assistant-input-row" onSubmit={handleSendChatMessage}>
              <div className="assistant-input-wrap">
                <textarea
                  className="assistant-input"
                  value={chatInputValue}
                  rows={1}
                  onChange={(e) => {
                    setChatInputValue(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  placeholder="Ask about your code…"
                  disabled={isChatLoading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChatMessage(e);
                    }
                  }}
                />
                <button
                  type="submit"
                  className="assistant-send"
                  disabled={!chatInputValue.trim() || isChatLoading}
                  title="Send (Enter)"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M.989 8 .064 2.68a1.342 1.342 0 0 1 1.88-1.485l11.985 5.855a1.342 1.342 0 0 1 0 2.4L1.944 15.304a1.342 1.342 0 0 1-1.88-1.484Z"/></svg>
                </button>
              </div>
              <p className="assistant-footer">Enter to send · Shift+Enter for new line</p>
            </form>
          </aside>
        )}
      </div>

      <footer className="status-bar">
        <div className="status-left">
          <span className="status-item">{statusMessage}</span>
        </div>
        <div className="status-right">
          {activeFile && (
            <>
              <span className="status-item">
                Ln {cursorPosition.line}, Col {cursorPosition.column}
              </span>
              <span className="status-item">Spaces: 2</span>
              <span className="status-item">UTF-8</span>
              <span className="status-item">LF</span>
              <span className="status-item">{getLanguageLabel(activeFile)}</span>
            </>
          )}
          <span
            className={`status-item clickable ${isChatOpen ? "active" : ""}`}
            onClick={() => setIsChatOpen((prev) => !prev)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsChatOpen((prev) => !prev);
              }
            }}
            role="button"
            tabIndex={0}
            title="Toggle assistant"
            aria-pressed={isChatOpen}
          >
            Assistant
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;