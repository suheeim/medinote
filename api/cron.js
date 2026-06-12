// cron-job.org が30分ごとに呼び出す。各ユーザーの服薬時刻が来ていれば LINE にプッシュ送信
// GET /api/cron
// ※ cron は cron-job.org の1ジョブのみ（30分間隔・*/30）。Vercel Cron は Hobby だと1日1回しか
//   動かないため使わない。WINDOW は cron間隔(30分)＋遅延ジッタを必ずカバーする値にすること。
import { kv } from './_kv.js';

const SLOT_LABEL = { morning: '朝', noon: '昼', evening: '夜', bed: '寝る前' };
// 服薬時刻から何分以内なら送信するか。cron は30分間隔なので、時刻直後の tick を逃すと
// 次の tick は最大約30分後になる。これ＋遅延ジッタを吸収するため 35 分。
// （二重送信は下の dedupeKey で防止されるので広めでも安全）
const WINDOW = 35;

export default async function handler(req, res){
  const TOKEN = process.env.LINE_MESSAGING_ACCESS_TOKEN;
  try{
    if(!TOKEN) throw new Error('LINE_MESSAGING_ACCESS_TOKEN が未設定です');

    const users = (await kv.smembers('medinote:users')) || [];
    const nowUtc = Date.now();
    let sent = 0;
    const diag = [];   // 各リマインダーの判定を返す（tzOffset/diff の検証用）

    for(const userId of users){
      const sched = await kv.get('medinote:sched:' + userId);
      if(!sched || !Array.isArray(sched.reminders) || !sched.reminders.length) continue;

      // tzOffset は getTimezoneOffset() の値（JST=UTC+9 なら -540）。
      //   ローカル壁時計 = UTC - tzOffset 分。よって local の UTC フィールドが現地時刻になる。
      //   例) 06:30 UTC, tz=-540 → new Date(06:30 + 9h) → getUTCHours()=15, getUTCMinutes()=30
      const tzOffset = Number.isFinite(sched.tzOffset) ? sched.tzOffset : -540; // 分（JST=-540）
      const local = new Date(nowUtc - tzOffset * 60000);
      const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes(); // 現地の「0時からの分」
      const dayKey = local.toISOString().slice(0, 10);
      const localHHMM = local.toISOString().slice(11, 16);

      for(const r of sched.reminders){
        const mm = /^(\d{1,2}):(\d{2})$/.exec(r.time || '');
        if(!mm) continue;
        const remMin = (+mm[1]) * 60 + (+mm[2]);

        // 服薬時刻から経過した分。日付境界（深夜0時）をまたぐ場合を考慮して -720..720 に正規化。
        //   例) reminder 23:50 / now 00:10 → 生diff=-1420 → +1440 = 20（=20分経過）として正しく判定
        let diff = nowMin - remMin;
        if(diff > 720) diff -= 1440;
        else if(diff < -720) diff += 1440;

        const due = diff >= 0 && diff <= WINDOW;   // まだ時刻前(diff<0) でも 過ぎすぎ(diff>WINDOW) でもない
        const dedupeKey = `medinote:sent:${userId}:${dayKey}:${r.slot}:${r.time}`;
        const already = due ? !!(await kv.get(dedupeKey)) : false; // 同日・同枠・同時刻は1回だけ

        const entry = { user: String(userId).slice(0, 8) + '…', localHHMM, time: r.time, slot: r.slot, diff, due, already };

        if(due && !already){
          const label = SLOT_LABEL[r.slot] || '';
          const text = `💊 ${label}のお薬の時間です（${r.time}）\n飲んだら「わたしの薬ノート」でチェックしましょう！`;

          let ok = false;
          try{
            const resp = await fetch('https://api.line.me/v2/bot/message/push', {
              method: 'POST',
              headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TOKEN },
              body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] })
            });
            ok = resp.ok;
            entry.pushStatus = resp.status;
            if(!ok) entry.error = (await resp.text()).slice(0, 200);
          }catch(e){
            entry.error = String(e.message || e);
          }

          // 送信成功時のみ重複防止フラグを立てる。
          //   失敗時に立ててしまうと、その日ずっとスキップされ通知が届かなくなるため、
          //   失敗は次の tick で再試行できるよう dedupe を立てない。
          if(ok){ await kv.set(dedupeKey, 1, { ex: 93600 }); sent++; } // 26時間保持
        }

        diag.push(entry);
      }
    }

    res.json({ ok: true, users: users.length, sent, nowUtc: new Date(nowUtc).toISOString(), diag });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
}
