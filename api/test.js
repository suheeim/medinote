// 診断用：登録ユーザー全員に即時テスト送信し、LINE APIの応答をそのまま返す
// GET /api/test
import { kv } from './_kv.js';

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  const TOKEN = process.env.LINE_MESSAGING_ACCESS_TOKEN;
  try{
    if(!TOKEN) throw new Error('LINE_MESSAGING_ACCESS_TOKEN が未設定です');

    // このトークンが属するボット（公式アカウント）の情報
    let botInfo = null;
    try{
      const bi = await fetch('https://api.line.me/v2/bot/info', { headers: { Authorization: 'Bearer ' + TOKEN } });
      botInfo = await bi.json();
    }catch(_){}

    const users = (await kv.smembers('medinote:users')) || [];
    const results = [];
    for(const u of users){
      // 友だち状態の確認（友だちなら200でプロフィール、未友だちは404）
      let friend = null;
      try{
        const fr = await fetch('https://api.line.me/v2/bot/profile/' + u, { headers: { Authorization: 'Bearer ' + TOKEN } });
        friend = { status: fr.status, body: (await fr.text()).slice(0, 200) };
      }catch(_){}

      const resp = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({ to: u, messages: [{ type: 'text', text: '🔔 わたしの薬ノート：テスト通知です。これが届けば設定完了です！' }] })
      });
      const body = await resp.text();
      results.push({ user: String(u).slice(0, 10) + '…', friend, pushStatus: resp.status, pushBody: body });
    }
    res.json({ ok: true, tokenLen: TOKEN.length, botInfo, users: users.length, results });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
}
