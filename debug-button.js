require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');
(async () => {
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    });
    if (fs.existsSync(COOKIES_PATH)) await ctx.addCookies(JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8')));
    const page = await ctx.newPage();

    // Profile page for Wild/Ieva who doesn't have a thread yet
    await page.goto('https://pazintys.draugas.lt/narys.cfm?narys=2203773', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { document.querySelectorAll('[id*="didomi"],.helpbox').forEach(e => e.remove()); });

    await page.screenshot({ path: 'debug_profile.png', timeout: 10000 });

    const result = await page.evaluate(() => {
        // Find ALL elements with Rašyti or žinutę text
        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
            const t = (el.innerText || el.textContent || '').trim();
            return (t.includes('Rašyti') || t.includes('žinute') || t.includes('Parašyk') || t.includes('zinute'))
                && t.length < 100 && el.children.length < 3;
        });
        return candidates.map(el => ({
            tag: el.tagName,
            text: (el.innerText || el.textContent || '').trim(),
            className: el.className,
            id: el.id,
            href: el.getAttribute('href'),
            onclick: el.getAttribute('onclick'),
            type: el.getAttribute('type'),
            outerHTML: el.outerHTML.substring(0, 300)
        })).slice(0, 10);
    });

    console.log('\n=== MYGTUKAI SU "Rašyti/žinutę" ===');
    result.forEach((r, i) => console.log(`[${i}] ${r.tag}.${r.className} | href="${r.href}" onclick="${r.onclick}" | html: ${r.outerHTML}`));

    await browser.close();
})().catch(err => { console.error(err.message); process.exit(1); });
