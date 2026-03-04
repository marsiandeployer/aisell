const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

async function testHydraAPI() {
    const apiKey = process.env.HYDRA_API_KEY;
    const baseUrl = process.env.HYDRA_BASE_URL || 'https://api.hydraai.ru/v1';

    console.log('=== Hydra API Test ===');
    console.log('API Key present:', !!apiKey);
    console.log('API Key length:', apiKey ? apiKey.length : 0);
    console.log('Base URL:', baseUrl);
    console.log('');

    // Test multiple models
    const models = ['gemini-3-flash', 'gemini-2.5-flash', 'claude-3.5-haiku'];

    for (const model of models) {
        console.log(`\n--- Testing with ${model} ---`);

        const requestBody = {
            model: model,
            messages: [{ role: 'user', content: 'Say just "Hi!"' }],
            max_tokens: 10
        };

        try {
            const response = await axios.post(
                `${baseUrl}/chat/completions`,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    timeout: 60000
                }
            );

            console.log('✅ SUCCESS!');
            console.log('Response:', JSON.stringify(response.data.choices[0].message, null, 2));

        } catch (error) {
            console.log('❌ ERROR:', error.message);

            if (error.response) {
                console.log('HTTP Status:', error.response.status);
                console.log('Content-Type:', error.response.headers['content-type']);
            } else if (error.code) {
                console.log('Error code:', error.code);
            }
        }
    }
}

testHydraAPI();
