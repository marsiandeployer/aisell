const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

/**
 * Тест Hydra API через axios с правильной конфигурацией
 * Сравниваем с работающим нативным https запросом
 */
async function testHydraWithAxios() {
    const apiKey = process.env.HYDRA_API_KEY;

    if (!apiKey) {
        console.error('❌ HYDRA_API_KEY not found');
        return;
    }

    console.log('🔄 Testing Hydra API with axios (fixed config)...');
    console.log(`✅ API Key found (length: ${apiKey.length})`);

    const url = 'https://api.hydraai.ru/v1/chat/completions';

    const data = {
        model: 'gemini-3-flash',
        messages: [
            { role: 'user', content: 'Привет! Скажи просто Hi!' }
        ],
        max_tokens: 10
    };

    console.log('\n📤 Request:');
    console.log('  URL:', url);
    console.log('  Body:', JSON.stringify(data));

    try {
        // ВАЖНО: Создаем новый axios instance без defaults
        const axiosInstance = axios.create({
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000,
            // КРИТИЧНО: отключаем proxy, maxRedirects и другие опции
            proxy: false,
            maxRedirects: 0,
            validateStatus: () => true, // Не кидать ошибку на любой статус
            transformRequest: [(data) => JSON.stringify(data)], // Явно сериализуем
            transformResponse: [(data) => {
                try {
                    return JSON.parse(data);
                } catch (e) {
                    return data;
                }
            }]
        });

        const response = await axiosInstance.post(url, data);

        console.log('\n📥 Response:');
        console.log(`  Status Code: ${response.status}`);
        console.log(`  Status Text: ${response.statusText}`);
        console.log(`  Content-Type: ${response.headers['content-type']}`);

        if (response.status === 200) {
            const message = response.data.choices[0].message.content;
            console.log(`\n✅ SUCCESS! Response: ${message}`);
        } else {
            console.log(`\n❌ ERROR ${response.status}`);
            console.log('Response data:',
                typeof response.data === 'string'
                    ? response.data.substring(0, 500)
                    : JSON.stringify(response.data).substring(0, 500)
            );
        }

    } catch (error) {
        console.error(`\n❌ Exception: ${error.message}`);
        if (error.response) {
            console.error(`  Status: ${error.response.status}`);
            console.error(`  Data:`,
                typeof error.response.data === 'string'
                    ? error.response.data.substring(0, 500)
                    : JSON.stringify(error.response.data).substring(0, 500)
            );
        }
    }
}

testHydraWithAxios();
