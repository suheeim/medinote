// アプリから服薬リマインダーのスケジュールを保存する
// POST /api/schedule { userId, reminders:[{time,slot}], tzOffset, authoritative? }
//
// authoritative: ユーザーの明示操作（追加・編集・削除）なら true。
//   起動時やクラウド同期からの「自動送信」は false（省略可）。
//   自動送信で reminders が空の場合は、既存の登録を消さない（＝アプリ起動のたびに
//   空データで上書きされて通知設定が消える問題を防ぐ）。明示操作のときだけ全削除を許可する。
import { kv } from './_kv.js';

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'POSTのみ' });

  try{
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { userId, reminders, tzOffset, authoritative } = body;
    if(!userId) return res.status(400).json({ error: 'userId が必要です' });

    const clean = Array.isArray(reminders)
      ? reminders.filter(r => /^\d{2}:\d{2}$/.test(r.time||'')).map(r => ({ time: r.time, slot: r.slot || 'morning' }))
      : [];

    const existing = await kv.get('medinote:sched:' + userId);
    let finalReminders = clean;
    // 自動送信（authoritative でない）で空が来た場合、既存の登録があれば消さない。
    // ＝アプリ起動時の空送信やクラウド同期の取りこぼしで設定が消えるのを防ぐ。
    let kept = false;
    if(clean.length === 0 && authoritative !== true
        && existing && Array.isArray(existing.reminders) && existing.reminders.length){
      finalReminders = existing.reminders;
      kept = true;
    }

    await kv.set('medinote:sched:' + userId, {
      reminders: finalReminders,
      tzOffset: Number.isFinite(tzOffset) ? tzOffset : (existing && Number.isFinite(existing.tzOffset) ? existing.tzOffset : -540), // 既定 JST(-540)
      updated: Date.now()
    });
    await kv.sadd('medinote:users', userId);

    res.json({ ok: true, count: finalReminders.length, kept });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
}
