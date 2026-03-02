require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');
(async () => {
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' });
    if (fs.existsSync(COOKIES_PATH)) await ctx.addCookies(JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8')));
    const page = await ctx.newPage();
    await page.goto('https://pazintys.draugas.lt/zinutes/thread/list', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { document.querySelectorAll('[id*="didomi"],.helpbox').forEach(e => e.remove()); });

    const result = await page.evaluate(() => {
        // Rasti thread sąrašo item'us
        const items = Array.from(document.querySelectorAll('.thread-item, .message-row, .susirasi-item, li, .conversation'))
            .filter(el => el.querySelector('a') && el.innerText.length > 5).slice(0, 5);
        if (items.length > 0) {
            return items.map(item => ({
                outerHTML: item.outerHTML.substring(0, 500),
                links: Array.from(item.querySelectorAll('a')).map(a => ({ text: a.innerText.trim(), href: a.href, class: a.className }))
            }));
        }
        // Fallback: visus linksus su vardais
        const all = Array.from(document.querySelectorAll('a')).filter(a => a.href.includes('pazintys') && a.innerText.trim().length > 2).slice(0, 20);
        return all.map(a => ({ text: a.innerText.trim(), href: a.href, class: a.className }));
    });

    console.log(JSON.stringify(result, null, 2));
    await page.screenshot({ path: 'debug_inbox.png' });
    await browser.close();
})();
