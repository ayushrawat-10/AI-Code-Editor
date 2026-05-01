import asyncio
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

from langchain_core.prompts import ChatPromptTemplate   # produces message list, not a plain string
from langchain_huggingface import HuggingFaceEndpoint, ChatHuggingFace
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# CORS fix
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Model setup ──────────────────────────────────────────────────────────────
llm = HuggingFaceEndpoint(
    repo_id="deepseek-ai/deepseek-coder-6.7b-instruct",
    task="text-generation",
    max_new_tokens=150,
    temperature=0.2,
)
model = ChatHuggingFace(llm=llm)

# ── Prompt  ──────────────────────────────────────────────────────────────────
# ChatPromptTemplate produces a list of messages — compatible with ChatHuggingFace
prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an AI coding assistant. "
        "Continue the given Python code logically and correctly. "
        "Return only the next lines of code, no explanations.",
    ),
    ("human", "{code}"),
])

chain = prompt | model

# ── Request schema ───────────────────────────────────────────────────────────
class CodeRequest(BaseModel):
    code: str

# ── Endpoint ─────────────────────────────────────────────────────────────────
@app.post("/suggest")
async def suggest_code(req: CodeRequest):
    # Run the blocking LLM call in a thread so the event loop stays free
    response = await asyncio.to_thread(chain.invoke, {"code": req.code})

    suggestion = response.content.strip()
    print("=== LLM suggestion ===")
    print(suggestion)
    print("======================")

    # Only prints to server terminal for now — not returned to frontend yet
    return {"suggestion": ""}