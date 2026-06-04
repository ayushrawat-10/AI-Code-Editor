import React from "react";
import "./LandingPage.css";

export default function LandingPage({ onStart }) {
  return (
    <div className="landing-container">
      {/* Background ambient glow shapes */}
      <div className="glow-orb glow-orb-1"></div>
      <div className="glow-orb glow-orb-2"></div>
      <div className="glow-orb glow-orb-3"></div>

      {/* Header / Navbar */}
      <header className="landing-header">
        <div className="landing-brand">
          <span className="brand-dot"></span>
          <span>CodeLab</span>
          <span className="brand-badge">AI IDE</span>
        </div>
        <div className="landing-nav-links">
          <a href="#features" className="nav-link">Features</a>
          <a href="#tech" className="nav-link">Tech Stack</a>
          <button className="nav-btn-start" onClick={onStart}>
            Launch Editor
          </button>
        </div>
      </header>

      {/* Main Hero Section */}
      <main className="landing-hero">
        <div className="hero-content">
          <div className="hero-tag">
            <span className="tag-sparkle">✨</span> Next-Gen Web IDE
          </div>
          <h1 className="hero-title">
            Write, Run, and Refactor <br />
            with <span className="gradient-text">AI Intelligence</span>
          </h1>
          <p className="hero-description">
            Experience CodeLab, a premium browser-based development environment. 
            Equipped with real-time AI code suggestions, multi-language compilation, 
            interactive AI chat, and a flexible resizable workspace.
          </p>

          <div className="hero-actions">
            <button className="btn-cta-primary" onClick={onStart}>
              <span>Start Coding</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </button>
            <a href="#features" className="btn-cta-secondary">
              Explore Features
            </a>
          </div>
        </div>

        {/* Hero Preview/Mockup of Code Editor */}
        <div className="hero-mockup-container">
          <div className="mockup-frame">
            <div className="mockup-header">
              <span className="mockup-dot red"></span>
              <span className="mockup-dot yellow"></span>
              <span className="mockup-dot green"></span>
              <span className="mockup-title">main.py — CodeLab</span>
            </div>
            <div className="mockup-body">
              <pre className="mockup-code">
<code>{`# Welcome to CodeLab!
def greet_ai(project_name):
    print(f"Welcome to {project_name}!")
    # AI completion suggested:
    assistant_status = "Ready to code"
    return assistant_status

# Click 'Start Coding' to run this code live!
greet_ai("CodeLab AI IDE")`}</code>
              </pre>
              <div className="mockup-ghost-completion">
                <span className="ghost-text">    # Press Tab to accept AI completion...</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Features Grid */}
      <section id="features" className="landing-features">
        <h2 className="section-title">Why Choose <span className="gradient-text">CodeLab</span>?</h2>
        <p className="section-subtitle">A feature-complete development platform built for modern programming workflows.</p>

        <div className="features-grid">
          {/* Card 1 */}
          <div className="feature-card">
            <div className="feature-icon-wrapper ai-spark">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
            </div>
            <h3>AI Coding Assistant</h3>
            <p>
              Instantly explain complex code blocks, fix logical errors, and generate inline documentation. 
              Chat directly with our LLM assistant for contextual code help.
            </p>
          </div>

          {/* Card 2 */}
          <div className="feature-card">
            <div className="feature-icon-wrapper terminal-run">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
            </div>
            <h3>Multi-Language Execution</h3>
            <p>
              Write and run Python, JavaScript, C, C++, and Rust programs. Check your compiler and runtime 
              outputs instantly in the integrated, interactive terminal panel.
            </p>
          </div>

          {/* Card 3 */}
          <div className="feature-card">
            <div className="feature-icon-wrapper autocomplete-ghost">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
            </div>
            <h3>Intelligent Autocomplete</h3>
            <p>
              Benefit from full VS Code-style dropdown IntelliSense dropdown suggestions, combined with 
              AI ghost-text predictions that you can accept by pressing Tab.
            </p>
          </div>

          {/* Card 4 */}
          <div className="feature-card">
            <div className="feature-icon-wrapper layout-drag">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
                <line x1="9" y1="9" x2="21" y2="9"></line>
              </svg>
            </div>
            <h3>Fully Draggable Workspace</h3>
            <p>
              Tailor the editor layout to your liking. Drag and resize the sidebar explorer, the terminal 
              panel, and the AI assistant to maximize your workspace.
            </p>
          </div>
        </div>
      </section>

      {/* Tech Stack Section */}
      <section id="tech" className="landing-tech">
        <h2 className="section-title">Technology <span className="gradient-text">Stack</span></h2>
        <p className="section-subtitle">Powered by modern industry-standard frameworks and libraries.</p>

        <div className="tech-grid">
          <div className="tech-badge">
            <span className="tech-logo react">⚛</span>
            <div className="tech-info">
              <h4>React.js</h4>
              <p>Frontend Architecture</p>
            </div>
          </div>
          <div className="tech-badge">
            <span className="tech-logo monaco">⌨</span>
            <div className="tech-info">
              <h4>Monaco Editor</h4>
              <p>Editor Engine</p>
            </div>
          </div>
          <div className="tech-badge">
            <span className="tech-logo fastapi">⚡</span>
            <div className="tech-info">
              <h4>FastAPI</h4>
              <p>Backend Service</p>
            </div>
          </div>
          <div className="tech-badge">
            <span className="tech-logo python">🐍</span>
            <div className="tech-info">
              <h4>Python 3</h4>
              <p>Execution & AI Agent</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-left">
          <p>© {new Date().getFullYear()} CodeLab IDE. All rights reserved.</p>
        </div>
        <div className="footer-center">
          <span className="college-capstone-tag">College Capstone Project</span>
        </div>
        <div className="footer-right">
          <button className="footer-btn" onClick={onStart}>Launch Application</button>
        </div>
      </footer>
    </div>
  );
}
