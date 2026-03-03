require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const NARYS_ID = '177123'; // Deimantė

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    });
    if (fs.existsSync(COOKIES_PATH)) await ctx.addCookies(JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8')));
    const page = await ctx.newPage();

    // 1. Profilio puslapis — laukti ilgiau (JS turinys)
    console.log('== 1. Profilio puslapis (networkidle) ==');
    await page.goto(`https://pazintys.draugas.lt/narys.cfm?narys=${NARYS_ID}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.evaluate(() => document.querySelectorAll('[id*="didomi"],.helpbox').forEach(e => e.remove()));

    const profilePage = await page.evaluate((id) => {
        const allLinks = Array.from(document.querySelectorAll('a')).map(a => ({
            text: a.innerText.trim().substring(0, 40),
            href: a.getAttribute('href'),
            title: a.getAttribute('title'),
            className: a.className
        })).filter(a => a.href && (
            a.href.includes('zinute') || a.href.includes('thread') || a.href.includes('message') ||
            a.href.includes(`narys=${id}`) || a.text.toLowerCase().includes('rašyt') ||
            a.text.toLowerCase().includes('žinut') || a.title?.toLowerCase().includes('žinut')
        ));

        const allButtons = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button]')).map(b => ({
            tag: b.tagName, text: b.innerText?.trim().substring(0, 40), value: b.value,
            className: b.className, id: b.id, title: b.getAttribute('title')
        }));

        const textareas = Array.from(document.querySelectorAll('textarea')).map(t => ({
            name: t.name, className: t.className, placeholder: t.placeholder, id: t.id
        }));

        return { allLinks, allButtons, textareas, currentUrl: window.location.href };
    }, NARYS_ID);

    console.log('Nuorodos:', JSON.stringify(profilePage.allLinks, null, 2));
    console.log('Mygtukai:', JSON.stringify(profilePage.allButtons, null, 2));
    console.log('Textarea:', JSON.stringify(profilePage.textareas, null, 2));

    // 2. Bandyti tiesioginį žinutės URL
    console.log('\n== 2. Žinutės URL bandymai ==');
    const urlsToTry = [
        `https://pazintys.draugas.lt/zinutes/thread/new?narys=${NARYS_ID}`,
        `https://pazintys.draugas.lt/zinutes/new?narys=${NARYS_ID}`,
        `https://pazintys.draugas.lt/zinutes.cfm?narys=${NARYS_ID}`,
        `https://pazintys.draugas.lt/zinute.cfm?narys=${NARYS_ID}`,
        `https://pazintys.draugas.lt/zinutes/thread/list`,
    ];

    for (const url of urlsToTry) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);
        const result = await page.evaluate(() => ({
            url: window.location.href,
            hasTextarea: !!document.querySelector('textarea'),
            hasForm: !!document.querySelector('form'),
            title: document.title.substring(0, 60),
            snippet: document.body.innerText.substring(0, 150).replace(/\n+/g, ' ')
        }));
        console.log(`${url} → ${result.url}`);
        console.log(`  textarea:${result.hasTextarea} | ${result.title} | ${result.snippet}`);
    }

    // 3. Thread sąrašas - pilna struktūra
    console.log('\n== 3. Thread sąrašas ==');
    await page.goto('https://pazintys.draugas.lt/zinutes/thread/list', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    const threads = await page.evaluate(() => {
        const body = document.body.innerHTML;
        const links = Array.from(document.querySelectorAll('a')).filter(a =>
            a.href.includes('thread') || a.href.includes('zinute') || a.href.includes('narys')
        ).map(a => ({ text: a.innerText.trim().substring(0, 50), href: a.href }));
        return { links: links.slice(0, 20), bodySnippet: document.body.innerText.substring(0, 500) };
    });
    console.log('Thread linkai:', JSON.stringify(threads.links, null, 2));
    console.log('Puslapis:', threads.bodySnippet);

    await browser.close();
})().catch(console.error);
