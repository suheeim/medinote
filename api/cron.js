// Vercel Cron が毎分呼び出す。各ユーザーの服薬時刻が来ていれば LINE にプッシュ送信
// GET /api/cron
import { kv } from './_kv.js';

const SLOT_LABEL = { morning: '朝', noon: '昼', evening: '夜', bed: '寝る前' };

export default async function handler(req, res){
  const TOKEN = process.env.LINE_MESSAGING_ACCESS_TOKEN;
  try{
    if(!TOKEN) throw new Error('LINE_MESSAGING_ACCESS_TOKEN が未設定です');

    const users = (await kv.smembers('medinote:users')) || [];
    const nowUtc = Date.now();
    let sent = 0;

    for(const userId of users){
      const sched = await kv.get('medinote:sched:' + userId);
      if(!sched || !Array.isArray(sched.reminders) || !sched.reminders.length) continue;

      const tzOffset = Number.isFinite(sched.tzOffset) ? sched.tzOffset : -540; // 分（JST=-540）
      const local = new Date(nowUtc - tzOffset * 60000); // ローカル壁時計を UTC として扱う
      const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
      const dayKey = local.toISOString().slice(0,10);
      const WINDOW = 15; // 服薬時刻から何分以内なら送信するか（cron間隔より広めに）

      for(const r of sched.reminders){
        const mm = /^(\d{1,2}):(\d{2})$/.exec(r.time || '');
        if(!mm) continue;
        const remMin = (+mm[1]) * 60 + (+mm[2]);
        const diff = nowMin - remMin;            // 服薬時刻から経過した分
        if(diff < 0 || diff > WINDOW) continue;  // まだ時刻前 or 過ぎすぎ（古いので送らない）
        // 二重送信防止（同日・同枠・同時刻は1回）
        const dedupeKey = `medinote:sent:${userId}:${dayKey}:${r.slot}:${r.time}`;
        if(await kv.get(dedupeKey)) continue;

        const label = SLOT_LABEL[r.slot] || '';
        const text = `💊 ${label}のお薬の時間です（${r.time}）\n飲んだら「わたしの薬ノート」でチェックしましょう！`;

        const resp = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TOKEN },
          body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] })
        });
        // 送信記録（26時間保持）。成否に関わらず多重送信は避ける
        await kv.set(dedupeKey, 1, { ex: 93600 });
        if(resp.ok) sent++;
      }
    }
    res.json({ ok: true, users: users.length, sent });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
}
