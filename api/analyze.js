// 写真からお薬情報を読み取る／飲み合わせチェック：Claude API をサーバー側で呼び出す
// APIキーは ANTHROPIC_API_KEY 環境変数に保持し、クライアントには露出しない
// POST /api/analyze { b64?, mediaType?, prompt, schema?, system? }
//   - b64 あり：画像＋テキスト（写真読み取り）
//   - b64 なし：テキストのみ（飲み合わせチェックなど）
export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'POSTのみ' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  try{
    if(!KEY) throw new Error('ANTHROPIC_API_KEY が未設定です');

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { b64, mediaType, prompt, schema, system } = body;
    // b64（画像）か prompt（テキスト）のどちらかは必須
    if(!b64 && !prompt) return res.status(400).json({ error: '画像データ(b64)またはテキスト(prompt)が必要です' });

    // b64 があれば画像＋テキスト、なければテキストのみのメッセージを組み立てる
    const content = b64
      ? [ { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: b64 } },
          { type: 'text', text: prompt || '' } ]
      : [ { type: 'text', text: prompt } ];

    const payload = {
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      messages: [{ role: 'user', content }]
    };
    if(system) payload.system = system;
    if(schema) payload.output_config = { format: { type: 'json_schema', schema } };

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if(!r.ok){
      return res.status(r.status).json({ error: data?.error?.message || ('APIエラー (' + r.status + ')') });
    }
    // Claude の応答（content 配列）をそのまま返し、解析はクライアント側で行う
    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message });
  }
}
