import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
# from langchain_openai import ChatOpenAI          # ← commented out (OpenAI)
from langchain_huggingface import HuggingFaceEndpoint, ChatHuggingFace
from langchain_core.prompts import PromptTemplate
from dotenv import load_dotenv
import json
import subprocess
import sys
import tempfile
import os

load_dotenv()

app = FastAPI()

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Model setup ──────────────────────────────────────────────────────────────
# HuggingFace — active
_hf_endpoint = HuggingFaceEndpoint(
    repo_id="Qwen/Qwen2.5-Coder-7B-Instruct",
    task="text-generation",
    max_new_tokens=120,
    temperature=0.2,
    streaming=True,
)
llm = ChatHuggingFace(llm=_hf_endpoint)

# ── Copilot-style prompt ──────────────────────────────────────────────────────
# ── Copilot-style prompt ──────────────────────────────────────────────────────
template = PromptTemplate(
    template="""You are a real-time AI code completion engine similar to GitHub Copilot.

Rules:
1. Return ONLY raw code — never markdown fences (no ```), never explanations.
2. Continue naturally from where the code left off.
3. Match the language, framework, and coding style already present.
4. Preserve indentation exactly.
5. Prefer short, precise completions (2-8 lines max).
6. Do not repeat or rewrite existing code.
7. If context ends mid-statement, complete it cleanly.

File context:
Writing file: {filename}

Current code:
{code}

""",
    input_variables=["code", "filename"]
)

chain = template | llm

# ── Request schema ───────────────────────────────────────────────────────────
class CodeRequest(BaseModel):
    code: str
    filename: str = "main.py"

class ExecuteRequest(BaseModel):
    code: str
    filename: str = "main.py"

# ── Streaming SSE endpoint ───────────────────────────────────────────────────
@app.post("/suggest/stream")
async def stream_suggestion(req: CodeRequest):
    """
    Streams AI code completion tokens back as Server-Sent Events.
    The frontend reads these with EventSource / fetch + ReadableStream.
    """
    async def token_generator():
        collected = []
        try:
            async for chunk in chain.astream({"code": req.code, "filename": req.filename}):
                token = chunk.content
                if token:
                    collected.append(token)
                    # SSE format: "data: <json>\n\n"
                    payload = json.dumps({"token": token})
                    yield f"data: {payload}\n\n"
            # Send a final done event with the full suggestion
            full = "".join(collected).strip()
            yield f"data: {json.dumps({'done': True, 'full': full})}\n\n"
            print(f"\n=== AI Suggestion (streamed: {req.filename}) ===")
            print(full)
            print("================================")
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        token_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering if proxied
        },
    )

# ── Non-streaming fallback (kept for compatibility) ──────────────────────────
@app.post("/suggest")
async def suggest_code(req: CodeRequest):
    """Receive code from the editor, run AI completion, return full suggestion."""
    response = await asyncio.to_thread(chain.invoke, {"code": req.code, "filename": req.filename})
    suggestion = response.content.strip()
    print(f"\n=== AI Suggestion ({req.filename}) ===")
    print(suggestion)
    print("=====================")
    return {"suggestion": suggestion}

# ── Code Execution Endpoint ──────────────────────────────────────────────────
active_process = None

@app.post("/execute")
async def execute_code(req: ExecuteRequest, request: Request):
    """
    Executes the submitted code dynamically based on file extension (supports Python, C, C++, HTML, JS, CSS, and Rust).
    """
    global active_process
    filename = req.filename or "main.py"
    ext = filename.split(".")[-1].lower() if "." in filename else "py"
    
    # Create a temporary file with the correct suffix
    suffix = f".{ext}"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False, mode="w", encoding="utf-8") as temp_file:
        temp_file.write(req.code)
        temp_file_path = temp_file.name

    process = None
    exe_path = None
    
    try:
        # Determine compilation and execution commands based on extension
        cmd = None
        compile_cmd = None
        
        if ext == "py":
            cmd = [sys.executable, temp_file_path]
        elif ext in ["cpp", "cc", "cxx"]:
            exe_name = temp_file_path.replace(".cpp", ".exe").replace(".cc", ".exe").replace(".cxx", ".exe")
            compile_cmd = ["g++", "-O2", temp_file_path, "-o", exe_name]
            exe_path = exe_name
            cmd = [exe_name]
        elif ext == "c":
            exe_name = temp_file_path.replace(".c", ".exe")
            compile_cmd = ["gcc", "-O2", temp_file_path, "-o", exe_name]
            exe_path = exe_name
            cmd = [exe_name]
        elif ext == "rs":
            exe_name = temp_file_path.replace(".rs", ".exe")
            compile_cmd = ["rustc", temp_file_path, "-o", exe_name]
            exe_path = exe_name
            cmd = [exe_name]
        elif ext == "js":
            cmd = ["node", temp_file_path]
        elif ext in ["html", "css"]:
            return {
                "stdout": f"[Info] Loaded '{filename}' in visual workspace.\nNote: HTML/CSS elements are rendered client-side inside the browser.\nTo see the full visual page layout, download the file and open it in a local web browser!",
                "stderr": "",
                "exit_code": 0,
            }
        else:
            # Fallback to Python
            cmd = [sys.executable, temp_file_path]

        # Terminate any existing running process first to prevent duplicates
        if active_process:
            try:
                active_process.terminate()
                active_process.kill()
            except Exception:
                pass

        # Perform compilation if required
        if compile_cmd:
            try:
                comp_proc = await asyncio.to_thread(
                    subprocess.run,
                    compile_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=8.0
                )
                if comp_proc.returncode != 0:
                    return {
                        "stdout": "",
                        "stderr": f"Compilation Error:\n{comp_proc.stderr or comp_proc.stdout}",
                        "exit_code": comp_proc.returncode,
                    }
            except FileNotFoundError:
                compiler_name = compile_cmd[0]
                return {
                    "stdout": "",
                    "stderr": f"Compilation Error: '{compiler_name}' compiler was not found on your system PATH.\nPlease make sure MinGW/GCC (for C/C++) or Rustup (for Rust) is installed and configured.",
                    "exit_code": -127,
                }
            except subprocess.TimeoutExpired:
                return {
                    "stdout": "",
                    "stderr": "Compilation Timeout: Compiling took longer than 8 seconds.",
                    "exit_code": -1,
                }

        # Start the execution subprocess
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
        )
        active_process = process
        
        # Run process.communicate asynchronously in a thread pool as a task to prevent blocking
        communicate_task = asyncio.create_task(
            asyncio.to_thread(process.communicate, timeout=5.0)
        )
        
        # Actively poll for client disconnection while the process is executing
        while not communicate_task.done():
            await asyncio.sleep(0.05)
            if await request.is_disconnected():
                # Client cancelled/aborted! Cancel task and kill subprocess immediately
                communicate_task.cancel()
                if process:
                    try:
                        process.terminate()
                        process.kill()
                    except Exception:
                        pass
                raise asyncio.CancelledError()
        
        stdout, stderr = await communicate_task
        
        return {
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": process.returncode,
        }
    except subprocess.TimeoutExpired:
        if process:
            try:
                process.terminate()
                process.kill()
            except Exception:
                pass
        return {
            "stdout": "",
            "stderr": "Execution Timeout: The program took longer than 5 seconds to run.",
            "exit_code": -1,
        }
    except asyncio.CancelledError:
        # If client disconnects or cancels, terminate the subprocess instantly
        if process:
            try:
                process.terminate()
                process.kill()
            except Exception:
                pass
        raise
    except FileNotFoundError:
        # Catch runtime not found (e.g. node not installed)
        runtime_name = cmd[0] if cmd else "executable"
        return {
            "stdout": "",
            "stderr": f"Execution Error: '{runtime_name}' runtime was not found on your system PATH.\nPlease make sure it is installed and configured.",
            "exit_code": -127,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()  # print exact traceback to backend console
        return {
            "stdout": "",
            "stderr": f"System Execution Error: {repr(e)}",
            "exit_code": -2,
        }
    finally:
        if active_process == process and process is not None:
            active_process = None
        # Guarantee deletion of the temporary file and compiled exe after run
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception:
                pass
        if exe_path and os.path.exists(exe_path):
            try:
                os.remove(exe_path)
            except Exception:
                pass


@app.post("/execute/stop")
async def stop_execution():
    """
    Terminates the active subprocess immediately using standard system signals.
    """
    global active_process
    if active_process:
        try:
            import signal
            if sys.platform == "win32":
                # Send Ctrl+C / Ctrl+Break to the Windows process group
                active_process.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                active_process.send_signal(signal.SIGINT)
            
            # Give the process a brief moment to exit gracefully and write traceback
            await asyncio.sleep(0.1)
            if active_process.poll() is None:
                active_process.terminate()
                active_process.kill()
        except Exception:
            try:
                active_process.terminate()
                active_process.kill()
            except Exception:
                pass
        active_process = None
        return {"status": "stopped", "message": "Subprocess terminated successfully."}
    return {"status": "idle", "message": "No active process to stop."}


# ── AI Chat Assistant Endpoint ───────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    code: str
    filename: str = "main.py"

chat_template = PromptTemplate(
    template="""You are a professional software engineering assistant. You help the user write, debug, explain, and optimize their code.

Active Context:
File name: {filename}
Current file contents:
```
{code}
```

Instructions:
Answer the user's question about their code or software engineering query. If they ask to write or modify code, provide the updated code snippets clearly. Keep your response concise, helpful, and professional. Do not use generic filler text.

User Question:
{message}

Assistant Response:
""",
    input_variables=["code", "filename", "message"]
)

chat_chain = chat_template | llm

@app.post("/chat")
async def chat_with_ai(req: ChatRequest):
    """Answers a user's question regarding the active code context."""
    try:
        response = await asyncio.to_thread(
            chat_chain.invoke, 
            {"code": req.code, "filename": req.filename, "message": req.message}
        )
        return {"response": response.content.strip()}
    except Exception as e:
        return {"response": f"AI Chat Error: Failed to generate response ({str(e)})"}


@app.post("/chat/stream")
async def chat_with_ai_stream(req: ChatRequest):
    """Answers a user's question regarding the active code context with streaming response."""
    async def token_generator():
        collected = []
        try:
            async for chunk in chat_chain.astream({
                "code": req.code,
                "filename": req.filename,
                "message": req.message
            }):
                token = chunk.content
                if token:
                    collected.append(token)
                    payload = json.dumps({"token": token})
                    yield f"data: {payload}\n\n"
            full = "".join(collected).strip()
            yield f"data: {json.dumps({'done': True, 'full': full})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        token_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )