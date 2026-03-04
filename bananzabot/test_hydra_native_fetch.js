const https = require('https');
const dotenv = require('dotenv');
dotenv.config();

/**
 * Тест Hydra API через нативный https без axios
 * Чтобы исключить проблемы с axios defaults
 */
function testHydraWithNativeHttps() {
    const apiKey = process.env.HYDRA_API_KEY;

    if (!apiKey) {
        console.error('❌ HYDRA_API_KEY not found');
        return;
    }

    console.log('🔄 Testing Hydra API with native https module...');
    console.log(`✅ API Key found (length: ${apiKey.length})`);

    const data = JSON.stringify({
        model: 'gemini-3-flash',
        messages: [
            { role: 'user', content: 'Привет! Скажи просто Hi!' }
        ],
        max_tokens: 10
    });

    const options = {
        hostname: 'api.hydraai.ru',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    console.log('\n📤 Request:');
    console.log('  URL:', `https://${options.hostname}${options.path}`);
    console.log('  Method:', options.method);
    console.log('  Headers:', JSON.stringify(options.headers, null, 2));
    console.log('  Body:', data);

    const req = https.request(options, (res) => {
        console.log('\n📥 Response:');
        console.log(`  Status Code: ${res.statusCode}`);
        console.log(`  Status Message: ${res.statusMessage}`);
        console.log(`  Headers:`, JSON.stringify(res.headers, null, 2));

        let responseData = '';

        res.on('data', (chunk) => {
            responseData += chunk;
        });

        res.on('end', () => {
            console.log('\n📄 Response Body:');

            if (res.statusCode === 200) {
                try {
                    const result = JSON.parse(responseData);
                    const message = result.choices[0].message.content;
                    console.log(`✅ SUCCESS! Response: ${message}`);
                } catch (e) {
                    console.log(responseData.substring(0, 500));
                }
            } else {
                console.log(`❌ ERROR ${res.statusCode}`);
                console.log(responseData.substring(0, 500));
            }
        });
    });

    req.on('error', (error) => {
        console.error(`❌ Request Error: ${error.message}`);
    });

    req.write(data);
    req.end();
}

testHydraWithNativeHttps();
