require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

// Deimantė profilis kuriam jau bandėm siųsti
const PROFILE_URL = 'https://pazintys.draugas.lt/narys.cfm?narys=177123';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    });
    if (fs.existsSync(COOKIES_PATH)) await ctx.addCookies(JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8')));
    const page = await ctx.newPage();

    console.log('== 1. Profilio nuorodos ir mygtukai ==');
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
        document.querySelectorAll('[id*="didomi"],.helpbox').forEach(e => e.remove());
    });

    const links = await page.evaluate(() => {
        // Visi linkai ir mygtukai su "žinut" arba "rašyt" arba "send" tekstu
        const items = Array.from(document.querySelectorAll('a, button')).filter(el => {
            const t = (el.innerText + el.getAttribute('title') + el.getAttribute('href') + el.className).toLowerCase();
            return t.includes('žinut') || t.includes('rašyt') || t.includes('siųst') || t.includes('send') || t.includes('message') || t.includes('zinute');
        });
        return items.map(el => ({
            tag: el.tagName,
            text: el.innerText.trim().substring(0, 50),
            href: el.getAttribute('href'),
            className: el.className,
            title: el.getAttribute('title'),
            id: el.id
        }));
    });
    console.log('Žinutės nuorodos:', JSON.stringify(links, null, 2));

    // Visi textarea ir formos
    const forms = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('form')).map(f => ({
            id: f.id,
            action: f.action,
            className: f.className,
            textareas: Array.from(f.querySelectorAll('textarea')).map(t => ({
                name: t.name, className: t.className, placeholder: t.placeholder
            })),
            buttons: Array.from(f.querySelectorAll('button, input[type=submit]')).map(b => ({
                tag: b.tagName, className: b.className, text: b.innerText.trim().substring(0, 30), type: b.type
            }))
        }));
    });
    console.log('\nFormos:', JSON.stringify(forms, null, 2));

    // Visi linkai su "zinutes" URL
    const zinLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).filter(a => a.href.includes('zinute') || a.href.includes('message') || a.href.includes('thread')).map(a => ({
            text: a.innerText.trim().substring(0, 50), href: a.href, className: a.className
        }));
    });
    console.log('\nZinučių linkai:', JSON.stringify(zinLinks, null, 2));

    console.log('\n== 2. Inbox URL struktūra ==');
    await page.goto('https://pazintys.draugas.lt/zinutes/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    console.log('Inbox URL:', page.url());
    const inboxLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).filter(a => a.href.includes('narys') || a.href.includes('thread') || a.href.includes('zinute')).slice(0, 10).map(a => ({
            text: a.innerText.trim().substring(0, 40), href: a.href
        }));
    });
    console.log('Inbox linkai:', JSON.stringify(inboxLinks, null, 2));

    await browser.close();
    console.log('\nBaigta.');
})().catch(console.error);
