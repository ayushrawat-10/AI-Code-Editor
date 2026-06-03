# AI Code Editor

A local AI-powered code editor with a React frontend and a FastAPI backend.

This project includes:
- `frontend/` — React app with Monaco Editor for in-browser code editing.
- `backend/` — FastAPI backend that provides AI completion, code execution, and streaming suggestions.

## Requirements

- Node.js and npm to run the frontend
- Python 3.10+ to run the backend
- `pip install -r backend/requirements.txt`

## Setup

### 1. Install frontend dependencies

```bash
cd frontend
npm install
```

### 2. Install backend dependencies

```bash
cd ../backend
pip install -r requirements.txt
```

## Running the project

### Start the backend

From `AI-Code-Editor/backend`:

```bash
uvicorn main:app --reload
```

This starts the backend on `http://127.0.0.1:8000`.

### Start the frontend

From `AI-Code-Editor/frontend`:

```bash
npm start
```

Then open `http://localhost:3000` in your browser.

## Notes

- The backend uses a Hugging Face endpoint through `langchain_huggingface` for AI completion.
- The API supports both streaming suggestions and non-streaming completion.
- CORS is enabled to allow frontend/backend communication during development.
- The backend also includes a code execution endpoint for supported languages.

## Development

- `frontend/package.json` contains the React app dependencies and scripts.
- `backend/main.py` contains the FastAPI application and AI/code execution logic.

## Troubleshooting

- If the frontend cannot connect, verify that the backend is running.
- If AI completions fail, check backend logs for Hugging Face or LangChain errors.

## License

This project is under active development.
