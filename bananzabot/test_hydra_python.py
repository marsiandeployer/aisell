#!/usr/bin/env python3
"""
Прямой тест Hydra AI API через Python requests (как в claritycult)
"""
import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

def test_hydra_api():
    """Тест HTTP запроса напрямую к Hydra AI"""
    print("🔄 Прямой HTTP тест к Hydra AI (Python requests)...")

    api_key = os.getenv("HYDRA_API_KEY")

    if not api_key:
        print("❌ HYDRA_API_KEY не найден")
        return

    print(f"✅ API Key найден (длина: {len(api_key)})")

    url = "https://api.hydraai.ru/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # Попробуем разные модели
    models_to_test = ['gemini-3-flash', 'gemini-2.5-flash', 'claude-3.5-haiku']

    for model in models_to_test:
        print(f"\n--- Тестирую модель: {model} ---")

        data = {
            "model": model,
            "messages": [
                {"role": "user", "content": "Привет! Скажи просто 'Hi!'"}
            ],
            "max_tokens": 10
        }

        try:
            response = requests.post(url, headers=headers, json=data, timeout=60)
            print(f"HTTP статус: {response.status_code}")

            if response.status_code == 200:
                result = response.json()
                message = result['choices'][0]['message']['content']
                print(f"✅ SUCCESS! Ответ от Hydra AI: {message}")
                break  # Если нашли рабочую модель, выходим
            else:
                print(f"❌ Ошибка HTTP {response.status_code}")
                print(f"Content-Type: {response.headers.get('content-type')}")
                print(f"Response: {response.text[:500]}")

        except Exception as e:
            print(f"❌ Исключение: {e}")

if __name__ == "__main__":
    test_hydra_api()
