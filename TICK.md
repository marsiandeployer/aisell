# TICK.md — aisell Project Health & Analytics

Проектный тик для aisell. Фокус: бизнес-аналитика и обнаружение аномалий.
Выполняй все секции последовательно, результаты выводи в отчёт.

---

## 1. Bot Creation Funnel (bananzabot)

Прочитай `bananzabot/user_data/conversations.json` и посчитай:

```bash
python3 -c "
import json, sys
from datetime import datetime, timedelta, timezone

with open('/root/aisell/bananzabot/user_data/conversations.json') as f:
    convs = json.load(f)

stages = {}
referrals = {}
stuck = []
now = datetime.now(timezone.utc)

for uid, c in convs.items():
    stage = c.get('stage', 'unknown')
    stages[stage] = stages.get(stage, 0) + 1

    ref = c.get('referralSource', '')
    if ref:
        referrals[ref] = referrals.get(ref, 0) + 1

    msgs = c.get('messages', [])
    last_ts = None
    for m in reversed(msgs):
        ts = m.get('timestamp')
        if ts:
            try:
                last_ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            except:
                pass
            break

    if last_ts:
        days_idle = (now - last_ts).days
        if stage == 'interactive_dialog' and days_idle > 7:
            name = (c.get('userInfo') or {}).get('fullName', uid)
            stuck.append(f'  {uid} ({name}): interactive_dialog, idle {days_idle}d')
        elif stage == 'awaiting_token_or_test' and days_idle > 3:
            name = (c.get('userInfo') or {}).get('fullName', uid)
            stuck.append(f'  {uid} ({name}): awaiting_token, idle {days_idle}d')

total = len(convs)
engaged = stages.get('interactive_dialog', 0) + stages.get('awaiting_token_or_test', 0) + stages.get('bot_created', 0)
created = stages.get('bot_created', 0)

print('=== Bot Creation Funnel ===')
print(f'Total users: {total}')
for s in ['awaiting_description', 'interactive_dialog', 'awaiting_token_or_test', 'bot_created']:
    cnt = stages.get(s, 0)
    pct = round(cnt/total*100, 1) if total else 0
    print(f'  {s}: {cnt} ({pct}%)')
print(f'Conversion: arrived({total}) -> engaged({engaged}, {round(engaged/total*100,1) if total else 0}%) -> bot_created({created}, {round(created/total*100,1) if total else 0}%)')

if stuck:
    print(f'\\n⚠️  Stuck users ({len(stuck)}):')
    for s in stuck:
        print(s)

if referrals:
    print(f'\\nReferral sources:')
    for ref, cnt in sorted(referrals.items(), key=lambda x: -x[1]):
        print(f'  {ref}: {cnt}')
"
```

---

## 2. Bot Activity & Engagement (bananzabot)

Используй `bananzabot/analytics.js` для сбора метрик, сравни с предыдущим снапшотом:

```bash
node -e '
const { collectBotMetrics, saveMetricsSnapshot } = require("/root/aisell/bananzabot/analytics.js");
const fs = require("fs");
const path = require("path");

(async () => {
  const m = await collectBotMetrics();

  // Load latest snapshot for delta
  const dir = "/root/aisell/bananzabot/analytics";
  let prev = null;
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.startsWith("metrics_")).sort();
    if (files.length > 0) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1])));
        prev = raw.metrics || raw;
      } catch(e) {}
    }
  }

  const delta = (cur, old, key) => {
    if (!old || old[key] === undefined) return "";
    const d = cur[key] - old[key];
    return d === 0 ? "" : (d > 0 ? " (+" + d + ")" : " (" + d + ")");
  };

  console.log("=== Bot Activity & Engagement ===");
  console.log("totalBots: " + m.totalBots + delta(m, prev, "totalBots"));
  console.log("activeBots: " + m.activeBots + delta(m, prev, "activeBots"));
  console.log("botsWithActivity: " + m.botsWithActivity + delta(m, prev, "botsWithActivity"));
  console.log("totalUsers: " + m.totalUsers + delta(m, prev, "totalUsers"));
  console.log("activeUsers: " + m.activeUsers + delta(m, prev, "activeUsers"));
  console.log("totalMessages: " + m.totalMessages + delta(m, prev, "totalMessages"));
  console.log("botActivityRate: " + m.botActivityRate);

  // Dormant bots: active status but 0 messages and >7d old
  const now = Date.now();
  const dormant = (m.botDetails || []).filter(b =>
    b.status === "active" && b.messages === 0 &&
    b.createdAt && (now - new Date(b.createdAt).getTime()) > 7*86400000
  );
  if (dormant.length > 0) {
    console.log("\nDormant bots (active, 0 msgs, >7d old): " + dormant.length);
    dormant.forEach(b => console.log("  " + b.botId + " (" + (b.nameprompt || "").slice(0,40) + ") created " + b.createdAt));
  }

  // Recently active (last 7d)
  const recentlyActive = (m.botDetails || []).filter(b =>
    b.lastActivity && (now - new Date(b.lastActivity).getTime()) < 7*86400000
  );
  console.log("\nRecently active bots (7d): " + recentlyActive.length);

  // Top 5 by messages
  const top5 = (m.botDetails || []).sort((a,b) => b.messages - a.messages).slice(0, 5);
  if (top5.length > 0) {
    console.log("\nTop 5 bots by messages:");
    top5.forEach((b, i) => console.log("  " + (i+1) + ". " + b.botId + ": " + b.messages + " msgs, " + b.users + " users"));
  }

  // Save new snapshot
  saveMetricsSnapshot({ timestamp: new Date().toISOString(), metrics: m });
  console.log("\nSnapshot saved.");
})().catch(e => console.error("Error:", e));
'
```

---

## 3. CRM Qualification Distribution

Прочитай `bananzabot/user_data/crm_followups.json` и посчитай распределение:

```bash
python3 -c "
import json

with open('/root/aisell/bananzabot/user_data/crm_followups.json') as f:
    crm = json.load(f)

verdicts = {}
followup_sent = 0
commercial_remaining = 0

for uid, entry in crm.items():
    q = entry.get('qualification', {})
    verdict = q.get('verdict', 'not_qualified')
    verdicts[verdict] = verdicts.get(verdict, 0) + 1

    if entry.get('personalFollowupSentAt'):
        followup_sent += 1
    elif verdict == 'commercial':
        commercial_remaining += 1

print('=== CRM Qualification Distribution ===')
total = len(crm)
print(f'Total leads: {total}')
for v in ['commercial', 'non_commercial', 'unclear', 'not_qualified']:
    cnt = verdicts.get(v, 0)
    pct = round(cnt/total*100, 1) if total else 0
    print(f'  {v}: {cnt} ({pct}%)')
print(f'Personal followups sent: {followup_sent}')
print(f'Commercial leads remaining (no followup): {commercial_remaining}')
"
```

---

## 3.5. Auto-Followup: Awaiting Description (7+ days idle)

Найди юзеров в `awaiting_description` (только /start, нет описания бота), неактивных 7+ дней, и отправь им напоминание:

```bash
cd /root/aisell/bananzabot && node << 'NODEEOF'
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CONVERSATIONS_PATH = path.join(__dirname, 'user_data', 'conversations.json');
const CRM_PATH = path.join(__dirname, 'user_data', 'crm_followups.json');

const FOLLOWUP_MESSAGE = `Какого бота будем делать? Опишите своими словами 🤖

Например:
• "Бот для приема заказов в кафе"
• "Бот для записи на консультации"
• "Бот для сбора отзывов"

Чем подробнее опишете — тем лучше я смогу помочь!`;

async function sendFollowup(userId, message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: userId,
      text: message
    });
    return { success: true };
  } catch (error) {
    const desc = error.response?.data?.description || error.message;
    return { success: false, error: desc };
  }
}

(async () => {
  const conversations = JSON.parse(fs.readFileSync(CONVERSATIONS_PATH, 'utf8'));
  const crm = fs.existsSync(CRM_PATH) ? JSON.parse(fs.readFileSync(CRM_PATH, 'utf8')) : {};

  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  let eligible = [];

  for (const [userId, conv] of Object.entries(conversations)) {
    // Filter: awaiting_description stage
    if (conv.stage !== 'awaiting_description') continue;

    // Check if already sent awaiting_description followup
    if (crm[userId]?.awaitingDescriptionFollowupSentAt) continue;

    // Get last message timestamp
    const msgs = conv.messages || [];
    let lastMsgTime = null;

    if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg.timestamp) {
        lastMsgTime = new Date(lastMsg.timestamp).getTime();
      }
    }

    // If no messages or last message >7 days ago
    const idleDays = lastMsgTime ? Math.floor((now - lastMsgTime) / (24*60*60*1000)) : 999;

    if (idleDays >= 7) {
      eligible.push({ userId, idleDays });
    }
  }

  console.log(`\n=== Auto-Followup: Awaiting Description ===`);
  console.log(`Eligible users (7+ days idle): ${eligible.length}\n`);

  if (eligible.length === 0) {
    console.log('No users to follow up.');
    return;
  }

  let sent = 0;
  let failed = 0;
  let blocked = 0;

  for (const { userId, idleDays } of eligible) {
    const result = await sendFollowup(userId, FOLLOWUP_MESSAGE);

    if (result.success) {
      // Update CRM
      if (!crm[userId]) crm[userId] = {};
      crm[userId].awaitingDescriptionFollowupSentAt = new Date().toISOString();
      sent++;
      console.log(`✅ Sent to ${userId} (idle ${idleDays}d)`);
    } else {
      if (result.error.includes('bot was blocked')) {
        blocked++;
        console.log(`❌ Blocked: ${userId}`);
      } else {
        failed++;
        console.log(`❌ Failed ${userId}: ${result.error}`);
      }
    }

    // Delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Save CRM state
  fs.writeFileSync(CRM_PATH, JSON.stringify(crm, null, 2));

  console.log(`\n=== Results ===`);
  console.log(`✅ Sent: ${sent}`);
  console.log(`❌ Blocked: ${blocked}`);
  console.log(`❌ Failed: ${failed}`);
})().catch(console.error);
NODEEOF
```

**Логика:**
- Отправляется юзерам в `awaiting_description` (только /start, нет описания)
- Idle 7+ дней
- СТРОГО 1 раз (поле `awaitingDescriptionFollowupSentAt` в `crm_followups.json`)
- Сообщение: стандартное приглашение описать бота с примерами

---

## 4. Webchat Usage & Feedback (botplatform)

Проверь пользователей, сессии и чаты webchat:

```bash
python3 -c "
import json, os, glob
from datetime import datetime, timezone

# Users
users_file = '/root/aisell/botplatform/data/webchat/users.json'
if os.path.exists(users_file):
    with open(users_file) as f:
        users = json.load(f)
    test_users = [u for u in users if str(u.get('userId','')).startswith('9000000000') or 'e2e' in (u.get('email','') + u.get('nickname','')).lower()]
    real_users = len(users) - len(test_users)
    print('=== Webchat Usage & Feedback ===')
    print(f'Users: {len(users)} total, {real_users} real, {len(test_users)} test')
else:
    print('=== Webchat Usage & Feedback ===')
    print('users.json not found')

# Sessions
sessions_file = '/root/aisell/botplatform/data/webchat/sessions.json'
if os.path.exists(sessions_file):
    with open(sessions_file) as f:
        sessions = json.load(f)
    now = datetime.now(timezone.utc)
    active = [s for s in sessions if datetime.fromisoformat(s['expiresAt'].replace('Z','+00:00')) > now]
    print(f'Sessions: {len(sessions)} total, {len(active)} active (non-expired)')
else:
    print('sessions.json not found')

# Chats
chats_dir = '/root/aisell/botplatform/data/webchat/chats'
if os.path.isdir(chats_dir):
    total_msgs = 0
    thumbs_up = 0
    thumbs_down = 0
    chat_files = glob.glob(os.path.join(chats_dir, '*.json'))
    users_with_chats = len(chat_files)
    for cf in chat_files:
        try:
            with open(cf) as f:
                msgs = json.load(f)
            total_msgs += len(msgs)
            for msg in msgs:
                fb = msg.get('feedback', {})
                if fb.get('type') == 'thumbs_up':
                    thumbs_up += 1
                elif fb.get('type') == 'thumbs_down':
                    thumbs_down += 1
        except:
            pass
    total_feedback = thumbs_up + thumbs_down
    sat_rate = round(thumbs_up / total_feedback * 100, 1) if total_feedback else 0
    print(f'Chats: {users_with_chats} users with chats, {total_msgs} messages')
    print(f'Feedback: {thumbs_up} up / {thumbs_down} down (satisfaction: {sat_rate}%)')
    if total_feedback == 0:
        print('  ⚠️  No feedback collected yet')
else:
    print('chats directory not found')
"
```

---

## 4.5. Feedback Log — комментарии к 👎

Прочитай лог фидбеков с комментариями. Лог хранится в `botplatform/data/webchat/feedback_log.jsonl` — каждая строка JSON с полями `at`, `userId`, `messageId`, `type`, `comment`, `messagePreview`.

```bash
python3 -c "
import json, os
from datetime import datetime, timezone, timedelta

log_path = '/root/aisell/botplatform/data/webchat/feedback_log.jsonl'
if not os.path.exists(log_path):
    print('=== Feedback Log ===')
    print('feedback_log.jsonl not found (no feedback yet)')
else:
    entries = []
    with open(log_path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except:
                    pass

    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    all_down = [e for e in entries if e.get('type') == 'thumbs_down']
    all_up   = [e for e in entries if e.get('type') == 'thumbs_up']
    with_comment = [e for e in all_down if e.get('comment')]
    recent_down  = [e for e in all_down if datetime.fromisoformat(e['at'].replace('Z','+00:00')) > week_ago]

    print('=== Feedback Log ===')
    print(f'Total: {len(entries)} entries ({len(all_up)} 👍 / {len(all_down)} 👎)')
    print(f'👎 with comment: {len(with_comment)} / {len(all_down)}')
    print(f'👎 last 7 days: {len(recent_down)}')

    if with_comment:
        print()
        print('--- 👎 Комментарии (последние 10) ---')
        for e in with_comment[-10:]:
            ts = e.get('at','')[:10]
            uid = e.get('userId','?')
            comment = e.get('comment','')
            preview = e.get('messagePreview','')[:80].replace(chr(10),' ')
            print(f'  [{ts}] user={uid}')
            print(f'    Ответ: {preview}')
            print(f'    Комментарий: {comment}')
    else:
        print()
        print('  Комментариев к 👎 ещё нет')
"
```

**Что делать если есть комментарии:**
- Паттерны ошибок → открыть соответствующий чат и проверить что пошло не так
- Частые жалобы на одно и то же → создать задачу на исправление промпта или логики

---

## 5. Onboarding Pipeline (botplatform)

Прочитай состояния и лиды онбординга:

```bash
python3 -c "
import json, os

# Onboarding states
states_file = '/root/aisell/botplatform/data/onboarding/onboarding_states.json'
if os.path.exists(states_file):
    with open(states_file) as f:
        states = json.load(f)
    # Filter out test users
    real = {uid: s for uid, s in states.items() if not str(s.get('userId','')).startswith('900000000')}
    steps = {}
    for uid, s in real.items():
        step = s.get('step', 'unknown')
        steps[step] = steps.get(step, 0) + 1
    print('=== Onboarding Pipeline ===')
    print(f'Total users: {len(real)} (filtered from {len(states)}, excluded test)')
    for step in ['idea', 'subscription', 'server']:
        cnt = steps.get(step, 0)
        pct = round(cnt/len(real)*100, 1) if real else 0
        print(f'  {step}: {cnt} ({pct}%)')
else:
    print('=== Onboarding Pipeline ===')
    print('onboarding_states.json not found')

# Onboarding leads
leads_file = '/root/aisell/botplatform/data/onboarding/onboarding_leads.json'
if os.path.exists(leads_file):
    with open(leads_file) as f:
        leads = json.load(f)
    real_leads = [l for l in leads if not str(l.get('userId','')).startswith('900000000')]
    has_server = sum(1 for l in real_leads if l.get('hasServer'))
    trivial = sum(1 for l in real_leads if len(l.get('idea','')) < 10)
    unique_users = len(set(l.get('userId') for l in real_leads))
    print(f'\\nLeads: {len(real_leads)} submissions from {unique_users} unique users')
    print(f'  has_server: {has_server} ({round(has_server/len(real_leads)*100,1) if real_leads else 0}%)')
    print(f'  trivial ideas (<10 chars): {trivial}')
else:
    print('onboarding_leads.json not found')
"
```

---

## 6. Referral Sources (botplatform)

Прочитай реферальные данные, дедуплицируй и покажи топ каналов:

```bash
python3 -c "
import json, os

refs_file = '/root/aisell/botplatform/data/referrals/user_referrals.json'
if not os.path.exists(refs_file):
    print('=== Referral Sources ===')
    print('user_referrals.json not found')
    exit()

with open(refs_file) as f:
    refs = json.load(f)

# Deduplicate by (userId, channelName, botProcessName)
seen = set()
unique = []
for r in refs:
    key = (r.get('userId'), r.get('channelName',''), r.get('botProcessName',''))
    if key not in seen:
        seen.add(key)
        unique.append(r)

print('=== Referral Sources ===')
print(f'Raw records: {len(refs)}, unique (userId+channel+bot): {len(unique)}')

# By channel
channels = {}
for r in unique:
    ch = r.get('channelName', 'unknown')
    channels[ch] = channels.get(ch, 0) + 1

print(f'\\nTop channels:')
for ch, cnt in sorted(channels.items(), key=lambda x: -x[1])[:10]:
    print(f'  {ch}: {cnt}')

# By bot
bots = {}
for r in unique:
    bot = r.get('botProcessName', 'unknown')
    bots[bot] = bots.get(bot, 0) + 1
print(f'\\nBy bot:')
for bot, cnt in sorted(bots.items(), key=lambda x: -x[1]):
    print(f'  {bot}: {cnt}')
"
```

---

## 6.5. Abandoned Workspace Cleanup (botplatform)

Найди и удали брошенные папки пользователей SimpleDashboard — нет изменений файлов 60+ дней, нет активных сессий.

```bash
python3 -c "
import json, os, shutil, time
from datetime import datetime, timezone

WORKSPACES_ROOT = '/root/aisell/botplatform/group_data'
USERS_FILE = '/root/aisell/botplatform/data/webchat/users.json'
SESSIONS_FILE = '/root/aisell/botplatform/data/webchat/sessions.json'
CHATS_DIR = '/root/aisell/botplatform/data/webchat/chats'
CUTOFF_DAYS = 60

now = datetime.now(timezone.utc)
now_ts = now.timestamp()

# Активные сессии (незаистекшие)
active_user_ids = set()
if os.path.exists(SESSIONS_FILE):
    with open(SESSIONS_FILE) as f:
        sessions = json.load(f)
    for s in sessions:
        try:
            exp = datetime.fromisoformat(s['expiresAt'].replace('Z', '+00:00'))
            if exp > now:
                active_user_ids.add(s['userId'])
        except:
            pass

to_delete = []
keep = []

for d in sorted(os.listdir(WORKSPACES_ROOT)):
    if not d.startswith('user_'):
        continue
    uid_str = d[len('user_'):]
    if not uid_str.isdigit():
        continue
    uid = int(uid_str)
    folder = os.path.join(WORKSPACES_ROOT, d)

    # Пропустить если активная сессия
    if uid in active_user_ids:
        keep.append(f'  {d}: active session — skip')
        continue

    # Найти время последнего изменения любого файла в папке
    latest_mtime = 0
    for fname in os.listdir(folder):
        fpath = os.path.join(folder, fname)
        try:
            mtime = os.path.getmtime(fpath)
            if mtime > latest_mtime:
                latest_mtime = mtime
        except:
            pass

    if latest_mtime == 0:
        # Пустая папка — только CLAUDE.md
        latest_mtime = os.path.getmtime(folder)

    idle_days = (now_ts - latest_mtime) / 86400

    if idle_days >= CUTOFF_DAYS:
        to_delete.append((d, uid, idle_days))
    else:
        keep.append(f'  {d}: {int(idle_days)}d idle — keep')

print(f'=== Abandoned Workspace Cleanup (>{CUTOFF_DAYS}d idle) ===')
print(f'Total workspaces scanned: {len(to_delete) + len(keep)}')
print(f'Active sessions: {len(active_user_ids)}')
print(f'To delete: {len(to_delete)}')
print(f'To keep: {len(keep)}')

if not to_delete:
    print('Nothing to delete.')
else:
    print()
    print('Deleting:')
    deleted = 0
    for (d, uid, idle_days) in to_delete:
        folder = os.path.join(WORKSPACES_ROOT, d)
        chat_file = os.path.join(CHATS_DIR, f'{uid}.json')
        try:
            shutil.rmtree(folder)
            if os.path.exists(chat_file):
                os.remove(chat_file)
            print(f'  ✅ Deleted {d} (idle {int(idle_days)}d)')
            deleted += 1
        except Exception as e:
            print(f'  ❌ Failed {d}: {e}')

    # Убрать из users.json (опционально — сохраняем email на случай повторного входа)
    # НЕ удаляем из users.json, чтобы userId не переиспользовался
    print(f'Deleted: {deleted}/{len(to_delete)} workspaces')
    print('Note: users.json entries kept (userId must not be reused)')
"
```

**Критерии удаления:**
- Нет активных сессий (не залогинен прямо сейчас)
- Последнее изменение файлов в папке — 60+ дней назад
- Удаляется: папка `group_data/user_{id}/` + файл чата `chats/{id}.json`
- НЕ удаляется: запись в `users.json` (чтобы userId не переиспользовался)

---

## 7. Anomaly Detection

Проверь аномалии:

```bash
python3 -c "
import json, os, glob
from datetime import datetime, timedelta, timezone

now = datetime.now(timezone.utc)
anomalies = []

# Check healthcheck_logs for recent errors
hc_dir = '/root/aisell/bananzabot/healthcheck_logs'
if os.path.isdir(hc_dir):
    hc_files = sorted(glob.glob(os.path.join(hc_dir, 'healthcheck_*.json')))
    if hc_files:
        try:
            with open(hc_files[-1]) as f:
                hc = json.load(f)
            if not hc.get('allOk'):
                failed = [r['name'] for r in hc.get('results', []) if not r.get('ok')]
                names = ', '.join(failed)
                anomalies.append(f'Last healthcheck FAILED: {names}')
        except:
            pass

# Check hydra_logs size
hydra_dir = '/root/aisell/bananzabot/user_data/hydra_logs'
if os.path.isdir(hydra_dir):
    total_size = sum(os.path.getsize(os.path.join(hydra_dir, f)) for f in os.listdir(hydra_dir) if os.path.isfile(os.path.join(hydra_dir, f)))
    if total_size > 50 * 1024 * 1024:
        anomalies.append(f'Hydra logs too large: {round(total_size/1024/1024, 1)}MB (>50MB)')

# Check if any conversations active in last 24h
conv_file = '/root/aisell/bananzabot/user_data/conversations.json'
if os.path.exists(conv_file):
    with open(conv_file) as f:
        convs = json.load(f)
    recent = False
    for uid, c in convs.items():
        for m in reversed(c.get('messages', [])):
            ts = m.get('timestamp')
            if ts:
                try:
                    t = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                    if (now - t).total_seconds() < 86400:
                        recent = True
                except:
                    pass
                break
        if recent:
            break
    if not recent:
        anomalies.append('No bananzabot conversations in last 24h')

# Check if all webchat sessions expired
sessions_file = '/root/aisell/botplatform/data/webchat/sessions.json'
if os.path.exists(sessions_file):
    with open(sessions_file) as f:
        sessions = json.load(f)
    active = [s for s in sessions if datetime.fromisoformat(s['expiresAt'].replace('Z','+00:00')) > now]
    if len(sessions) > 0 and len(active) == 0:
        anomalies.append(f'All {len(sessions)} webchat sessions expired — no active users')

# Check tips with failed status
tips_file = '/root/aisell/bananzabot/user_data/tips_state.json'
if os.path.exists(tips_file):
    with open(tips_file) as f:
        tips = json.load(f)
    failed = 0
    for uid, data in tips.items():
        for tid, tip in data.get('tips', {}).items():
            if tip.get('status') == 'failed':
                failed += 1
    if failed > 0:
        anomalies.append(f'{failed} tips in failed status — check errors in tips_state.json')

print('=== Anomaly Detection ===')
if anomalies:
    for a in anomalies:
        print(f'⚠️  {a}')
else:
    print('No anomalies detected.')
"
```

---

## 8. Documentation Review (aisell)

Проверь актуальность ключевых документов проекта:

```bash
python3 -c "
import os, re
from datetime import datetime

docs = {
    'CLAUDE.md': '/root/aisell/CLAUDE.md',
    'README.md': '/root/aisell/README.md',
    'ARCHITECTURE.md': '/root/aisell/ARCHITECTURE.md',
    'AUTH-FLOWS.md': '/root/aisell/AUTH-FLOWS.md',
    'products/README.md': '/root/aisell/products/README.md',
}

print('=== Documentation Review ===')
for name, path in docs.items():
    if not os.path.exists(path):
        print(f'  ❌ {name}: NOT FOUND')
        continue
    mtime = datetime.fromtimestamp(os.path.getmtime(path))
    age = (datetime.now() - mtime).days
    with open(path) as f:
        content = f.read()
    lines = content.count('\n')
    # Check for TBD/TODO
    tbds = len(re.findall(r'\bTBD\b|\bTODO\b', content, re.IGNORECASE))
    flag = '⚠️ ' if age > 30 or tbds > 0 else '✅'
    notes = []
    if age > 30:
        notes.append(f'{age}d old')
    if tbds > 0:
        notes.append(f'{tbds} TBD/TODO')
    note_str = f' ({', '.join(notes)})' if notes else ''
    print(f'  {flag} {name}: {lines} lines, modified {mtime.strftime(\"%Y-%m-%d\")}{note_str}')
"
```

**Что проверять вручную:**
- Список продуктов в CLAUDE.md и ARCHITECTURE.md совпадает с реальными `products/` папками
- Порты и домены в README.md совпадают с `ecosystem.config.js` и nginx конфигами
- Moltbook API URL актуален (base: `https://www.moltbook.com/api/v1/`)
- Chrome Extension примеры содержат `--short-name` флаг
- SimpleCrypto webchat URL: `https://simplecrypto.wpmix.net` (порт 8096)
