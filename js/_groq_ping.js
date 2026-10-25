const key = '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';
async function ping(model) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with OK' }],
      max_completion_tokens: 32
    })
  });
  const text = await res.text();
  console.log('MODEL', model, 'STATUS', res.status);
  console.log(text.slice(0, 800));
}
(async () => {
  for (const m of ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
    try { await ping(m); } catch (e) { console.log('ERR', m, e.message); }
  }
})();
