// CHANGE: Test script to verify welcome message quality improvements
// WHY: Need to validate that welcome message has correct formatting and wording
// REF: User feedback on welcome message quality

const puppeteer = require('puppeteer');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function testWelcomeMessage() {
    console.log('Starting welcome message test...');

    const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: { width: 1280, height: 800 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
        const page = await browser.newPage();

        // Navigate to Telegram Web
        console.log('Opening Telegram Web...');
        await page.goto('https://web.telegram.org/k/#@bananza_bot', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Take screenshot
        const screenshotPath = '/root/space2/bananzabot/tests/welcome_message_test.png';
        await page.screenshot({
            path: screenshotPath,
            fullPage: true
        });
        console.log(`Screenshot saved: ${screenshotPath}`);

        // Check for key phrases in the welcome message
        const pageContent = await page.content();

        const checks = {
            'бизнес-процесс': pageContent.includes('бизнес-процесс'),
            'Telegram-бота': pageContent.includes('Telegram-бота') || pageContent.includes('Telegram бота'),
            'API-ключей': pageContent.includes('API-ключей') || pageContent.includes('API ключей'),
            'всё одним': pageContent.includes('всё одним') || pageContent.includes('все одним')
        };

        console.log('\nChecking for quality improvements:');
        Object.entries(checks).forEach(([phrase, found]) => {
            console.log(`  ${found ? '✅' : '❌'} "${phrase}"`);
        });

        // Send screenshot to admin
        console.log('\nSending screenshot to admin...');
        await execPromise(`python3 /root/space2/hababru/telegram_sender.py "отправь @sashanoxon ${screenshotPath} Тест приветственного сообщения bananzabot после исправлений"`);

        console.log('\n✅ Test completed successfully!');

        return {
            success: true,
            checks,
            screenshotPath
        };

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// Run test
testWelcomeMessage()
    .then(result => {
        console.log('\nTest result:', JSON.stringify(result, null, 2));
        process.exit(0);
    })
    .catch(error => {
        console.error('Test error:', error);
        process.exit(1);
    });
