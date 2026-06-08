// アプリから服薬リマインダーのスケジュールを保存する
// POST /api/schedule { userId, reminders:[{time,slot}], tzOffset }
import { kv } from '@vercel/kv';

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'POSTのみ' });

  try{
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { userId, reminders, tzOffset } = body;
    if(!userId) return res.status(400).json({ error: 'userId が必要です' });

    const clean = Array.isArray(reminders)
      ? reminders.filter(r => /^\d{2}:\d{2}$/.test(r.time||'')).map(r => ({ time: r.time, slot: r.slot || 'morning' }))
      : [];

    await kv.set('medinote:sched:' + userId, {
      reminders: clean,
      tzOffset: Number.isFinite(tzOffset) ? tzOffset : -540, // 既定 JST(-540)
      updated: Date.now()
    });
    await kv.sadd('medinote:users', userId);

    res.json({ ok: true, count: clean.length });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
}
