const k = process.env.GEMINI_API_KEY;
const models = process.argv.slice(2);
for (const m of models) {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Reply only with JSON {"answer":"..."}' }] },
        contents: [{ role: 'user', parts: [{ text: 'What is the capital of France?' }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const d = await r.json();
    const t = d.candidates?.[0]?.content?.parts?.map((p) => p.text).join('');
    console.log(m, r.status, JSON.stringify((t || '').slice(0, 160)), d.error?.message || '');
  } catch (e) {
    console.log(m, 'ERR', e.message);
  }
}
