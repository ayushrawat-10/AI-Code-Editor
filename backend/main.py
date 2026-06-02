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

Current code:
{code}

""",
    input_variables=["code"]
)

chain = template | llm

# ── Request schema ───────────────────────────────────────────────────────────
class CodeRequest(BaseModel):
    code: str

class ExecuteRequest(BaseModel):
    code: str

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
            async for chunk in chain.astream({"code": req.code}):
                token = chunk.content
                if token:
                    collected.append(token)
                    # SSE format: "data: <json>\n\n"
                    payload = json.dumps({"token": token})
                    yield f"data: {payload}\n\n"
            # Send a final done event with the full suggestion
            full = "".join(collected).strip()
            yield f"data: {json.dumps({'done': True, 'full': full})}\n\n"
            print("\n=== AI Suggestion (streamed) ===")
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
    response = await asyncio.to_thread(chain.invoke, {"code": req.code})
    suggestion = response.content.strip()
    print("\n=== AI Suggestion ===")
    print(suggestion)
    print("=====================")
    return {"suggestion": suggestion}

# ── Code Execution Endpoint ──────────────────────────────────────────────────
active_process = None

@app.post("/execute")
async def execute_code(req: ExecuteRequest, request: Request):
    """
    Executes the submitted Python code in a safe subprocess and returns stdout/stderr.
    """
    global active_process
    # Create a temporary file to write the submitted Python code
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w", encoding="utf-8") as temp_file:
        temp_file.write(req.code)
        temp_file_path = temp_file.name

    try:
        # Terminate any existing running process first to prevent duplicates
        if active_process:
            try:
                active_process.terminate()
                active_process.kill()
            except Exception:
                pass

        # Start the subprocess synchronously in the background (platform independent)
        process = subprocess.Popen(
            [sys.executable, temp_file_path],
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
    except Exception as e:
        import traceback
        traceback.print_exc()  # print exact traceback to backend console
        return {
            "stdout": "",
            "stderr": f"System Execution Error: {repr(e)}",
            "exit_code": -2,
        }
    finally:
        if active_process == process:
            active_process = None
        # Guarantee deletion of the temporary file after run
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
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