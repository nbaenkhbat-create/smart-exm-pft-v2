const fs = require('fs');
const key = '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';
const b64 = fs.readFileSync('c:/BUSINESS/smart exam v2/js/_sample_quiz.jpg').toString('base64');
async function run() {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      temperature: 0.1,
      max_completion_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Extract quiz as JSON: {"title":"","questions":[{"text":"","type":"mcq","options":[{"key":"A","text":""},{"key":"B","text":""},{"key":"C","text":""},{"key":"D","text":""}],"answer":"B"}]}' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } }
        ]
      }]
    })
  });
  console.log('STATUS', res.status);
  console.log(await res.text());
}
run().catch(e => console.error(e));
