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
# OpenAI (commented out — switch back by uncommenting and commenting HF block)
# llm = ChatOpenAI(
#     model="gpt-4o-mini",
#     temperature=0.2,
#     max_tokens=120,
#     streaming=True,
# )

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