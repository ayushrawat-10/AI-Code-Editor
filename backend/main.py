import asyncio
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

from langchain_core.prompts import PromptTemplate
from langchain_huggingface import HuggingFaceEndpoint, ChatHuggingFace
from dotenv import load_dotenv

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
llm = HuggingFaceEndpoint(
    repo_id="Qwen/Qwen3-Coder-Next",
    task="text-generation",
    max_new_tokens=120,
    temperature=0.2,
)
model = ChatHuggingFace(llm=llm)

# ── Copilot-style prompt ──────────────────────────────────────────────────────
# Returns only raw code — no markdown, no explanation.
template = PromptTemplate(
    template="""You are a real-time AI code completion engine similar to GitHub Copilot.

Rules:
1. Return only code — never markdown, never explanations.
2. Continue from the exact cursor context.
3. Match the language, framework, and coding style already present.
4. Preserve indentation.
5. Prefer short, precise completions (2-8 lines max).
6. Do not rewrite existing code.
7. If the code is syntactically broken, complete or repair it naturally.

Current code:
{code}

Continuation:""",
    input_variables=["code"]
)

chain = template | model

# ── Request schema ───────────────────────────────────────────────────────────
class CodeRequest(BaseModel):
    code: str

# ── Endpoint ─────────────────────────────────────────────────────────────────
@app.post("/suggest")
async def suggest_code(req: CodeRequest):
    """Receive code from the editor, run AI completion, return suggestion."""
    # Run the blocking LLM call in a thread so the async event loop stays free
    response = await asyncio.to_thread(chain.invoke, {"code": req.code})

    suggestion = response.content.strip()

    # Keep terminal output for debugging
    print("\n=== AI Suggestion ===")
    print(suggestion)
    print("=====================")

    return {"suggestion": suggestion}