# Jupyter Prompt Notebook

A single-screen clone of the Jupyter Notebook 7 editor (light theme). You type **prompts** in the input cell and press **Run** (or Shift+Enter). An LLM returns a complete notebook of Python code cells, each with a short plain-text markdown description. The cells are appended, and the input cell moves to the bottom. Each later prompt sends the earlier turns as context, so you can revise or fix the latest notebook.

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
| `OPENAI_API_KEY` | yes | |
| `OPENAI_MODEL` | yes | e.g. `gpt-4.1` |
| `OPENAI_BASE_URL` | no | For OpenAI-compatible providers |
| `OPENAI_MAX_TOKENS` | no | Output token cap. Defaults to `32768`; set it to your model's maximum. If the provider rejects it, the request is retried with `max_completion_tokens` and then without a cap. |

## Deploy on Vercel

Import the repository into Vercel (framework: Next.js) and add the variables above under **Project → Settings → Environment Variables**. Responses stream, and the route asks for `maxDuration = 300` (Vercel caps this at your plan's limit).
