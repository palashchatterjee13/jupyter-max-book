# Jupyter Prompt Notebook

A single-screen clone of the Jupyter Notebook 7 editor (light theme). You type **prompts** in the input cell and press **Run** (or Shift+Enter). A Gemini model (via the official `@google/genai` SDK) returns a complete notebook of Python code cells, each with a short plain-text markdown description. The cells are appended, and the input cell moves to the bottom. Each later prompt sends the earlier turns as context, so you can revise or fix the latest notebook.

- Every output can be downloaded as its own `.ipynb` file: use the download icon on any cell of that output, or **File → Download**.
- No code actually runs. The only server code is one Next.js route handler (`app/api/generate`), which keeps your API key off the browser.
- The notebook is autosaved to `localStorage`.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev
```

| Variable | Required | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | From [Google AI Studio](https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | yes | e.g. `gemini-2.5-pro` |
| `GEMINI_MAX_TOKENS` | no | Output token cap (`maxOutputTokens`). Defaults to `32768`; set it to your model's maximum. |

## Deploy on Vercel

Import the repository into Vercel (framework: Next.js) and add the variables above under **Project → Settings → Environment Variables**. Responses stream, and the route asks for `maxDuration = 300` (Vercel caps this at your plan's limit).
