const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    context.addCookies(JSON.parse(fs.readFileSync('cookies.json')));
    const page = await context.newPage();
    await page.goto('https://pazintys.draugas.lt/narys.cfm?narys=3770679', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    try {
        const consentSelectors = ['button:has-text("SUTINKU")', 'button:has-text("Sutinkame")'];
        for (const sel of consentSelectors) {
            const btn = page.locator(sel).first();
            if (await btn.count() > 0 && await btn.isVisible()) {
                await btn.click({ force: true, timeout: 3000 }).catch(() => { });
                await page.waitForTimeout(1000);
            }
        }
    } catch (e) { }
    const writeBtn = page.locator('.button-write-message, .button-new-message, .__callNewMessage').first();
    if (await writeBtn.count() > 0) {
        await writeBtn.click();
        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'investigation2.png' });
        const html = await page.evaluate(() => document.body.innerHTML);
        fs.writeFileSync('investigation_dom2.html', html);
        console.log('Capture 2 done');
    } else {
        console.log('No write btn');
    }
    await browser.close();
})();
