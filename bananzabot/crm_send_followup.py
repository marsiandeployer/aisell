#!/usr/bin/env python3
"""
Отправка CRM followup конкретному пользователю через бот.
Использование: python3 crm_send_followup.py <UID> "<TEXT>"

Вызывается из /tick после одобрения текста пользователем.
"""
import json, sys, os, urllib.request, urllib.parse
from datetime import datetime, timezone

CRM_PATH = os.path.join(os.path.dirname(__file__), 'user_data/crm_followups.json')
CONV_DIR = os.path.join(os.path.dirname(__file__), 'user_data/conversations')

def load_env():
    env = {}
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def send_telegram(token, chat_id, text):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode()
    req = urllib.request.Request(url, data=payload,
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)

def append_to_conversation(uid, text):
    conv_path = os.path.join(CONV_DIR, str(uid), 'conversation.json')
    if not os.path.exists(conv_path):
        return
    with open(conv_path) as f:
        conv = json.load(f)
    if not isinstance(conv.get('messages'), list):
        conv['messages'] = []
    conv['messages'].append({
        'role': 'assistant',
        'content': text,
        'timestamp': datetime.now(timezone.utc).isoformat()
    })
    with open(conv_path, 'w') as f:
        json.dump(conv, f, ensure_ascii=False, indent=2)

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 crm_send_followup.py <UID> '<TEXT>'")
        sys.exit(1)

    uid = sys.argv[1]
    text = sys.argv[2]

    env = load_env()
    token = env.get('TELEGRAM_BOT_TOKEN', '')
    if not token:
        print("ERROR: TELEGRAM_BOT_TOKEN not found in .env")
        sys.exit(1)

    # Загрузить CRM
    with open(CRM_PATH) as f:
        crm = json.load(f)

    entry = crm.get(uid, {})

    # Отправить
    try:
        result = send_telegram(token, uid, text)
        if not result.get('ok'):
            print(f"ERROR: Telegram API returned not ok: {result}")
            sys.exit(1)
    except urllib.error.HTTPError as e:
        code = e.code
        if code == 403:
            print(f"BLOCKED: User {uid} blocked the bot")
            entry['followupStatus'] = 'blocked'
        elif code == 400:
            print(f"NOT_FOUND: Chat {uid} not found (user never started bot)")
            entry['followupStatus'] = 'chat_not_found'
        else:
            print(f"HTTP ERROR {code}: {e}")
            entry['followupStatus'] = 'send_failed'
        crm[uid] = {**entry, 'updatedAt': datetime.now(timezone.utc).isoformat()}
        with open(CRM_PATH, 'w') as f:
            json.dump(crm, f, ensure_ascii=False, indent=2)
        sys.exit(1)

    # Обновить CRM
    now = datetime.now(timezone.utc).isoformat()
    crm[uid] = {
        **entry,
        'status': 'followup_ready',
        'followupText': text,
        'followupStatus': 'sent',
        'lastSentAt': now,
        'sentCount': entry.get('sentCount', 0) + 1,
        'updatedAt': now,
    }
    with open(CRM_PATH, 'w') as f:
        json.dump(crm, f, ensure_ascii=False, indent=2)

    # Добавить в историю диалога
    append_to_conversation(uid, text)

    print(f"OK: Sent to {uid} (total sent: {crm[uid]['sentCount']})")
    print(f"Text: {text}")

if __name__ == '__main__':
    main()
