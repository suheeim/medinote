// リンクコードに対応する連携結果を返す（PWAがポーリングで取得する）
// GET /api/line/status?code=<linkCode>
import { kv } from '../_kv.js';

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if(req.method === 'OPTIONS') return res.status(200).end();

  try{
    const code = (req.query.code || '').toString().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if(!code) return res.status(400).json({ error: 'code が必要です' });

    const data = await kv.get('medinote:link:' + code);
    if(data && data.userId){
      // 一度取得したら破棄（使い捨てコード）
      await kv.del('medinote:link:' + code);
      return res.json({ linked: true, userId: data.userId, name: data.name || '' });
    }
    res.json({ linked: false });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
}
