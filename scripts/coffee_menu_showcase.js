const puppeteer = require('puppeteer');

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();

    console.log('Navigating to http://localhost:8091 ...');
    await page.goto('http://localhost:8091', { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('Page loaded, taking initial screenshot...');
    await page.screenshot({ path: '/tmp/step1_initial.png', fullPage: true });

    // Wait for input field
    console.log('Waiting for #input...');
    await page.waitForSelector('#input', { timeout: 15000 });

    // Type the prompt
    const prompt = "Cozy coffee shop menu online with coffee background image: espresso $3, latte $4, cappuccino $4.50. Small 'Print QR code' button to share menu link";
    console.log('Typing prompt:', prompt);
    await page.click('#input');
    await page.type('#input', prompt, { delay: 20 });

    await page.screenshot({ path: '/tmp/step2_typed.png', fullPage: true });

    // Submit the message
    console.log('Submitting message...');
    await page.keyboard.press('Enter');

    await page.screenshot({ path: '/tmp/step3_submitted.png', fullPage: true });

    // Wait for AI response - look for .bubble.assistant
    console.log('Waiting for AI response (.bubble.assistant)...');
    await page.waitForSelector('.bubble.assistant', { timeout: 120000 });

    console.log('AI response appeared, waiting for it to complete...');
    // Wait a bit more for the response to finish streaming
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check if there's a loading indicator still active
    let retries = 0;
    while (retries < 30) {
      const isLoading = await page.evaluate(() => {
        const loadingEl = document.querySelector('.loading, .typing, .spinner, [data-loading="true"]');
        return !!loadingEl;
      });
      if (!isLoading) break;
      console.log(`Still loading, waiting... (retry ${retries + 1})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      retries++;
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    await page.screenshot({ path: '/tmp/step4_ai_response.png', fullPage: true });
    console.log('Chat screenshot saved');

    // Now navigate to /preview
    console.log('Navigating to http://localhost:8091/preview ...');
    const previewPage = await browser.newPage();
    previewPage.setDefaultNavigationTimeout(30000);
    await previewPage.goto('http://localhost:8091/preview', { waitUntil: 'networkidle2', timeout: 30000 });

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Taking preview screenshot...');
    await previewPage.screenshot({
      path: '/root/aisell/products/simple_site/showcases/coffee-menu.png',
      fullPage: true
    });

    console.log('Preview screenshot saved to /root/aisell/products/simple_site/showcases/coffee-menu.png');

    await previewPage.screenshot({ path: '/tmp/step5_preview.png', fullPage: true });

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
