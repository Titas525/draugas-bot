require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    });
    if (fs.existsSync(COOKIES_PATH)) await ctx.addCookies(JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8')));
    const page = await ctx.newPage();

    // 1. Toma profilis
    console.log('== Toma profilis (5616693) ==');
    await page.goto('https://pazintys.draugas.lt/narys.cfm?narys=5616693', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => document.querySelectorAll('[id*="didomi"],.helpbox').forEach(e => e.remove()));

    const profileData = await page.evaluate(() => {
        // Textarea formos
        const forms = Array.from(document.querySelectorAll('form')).map(f => ({
            action: f.action, method: f.method, id: f.id,
            textareas: Array.from(f.querySelectorAll('textarea')).map(t => ({id: t.id, name: t.name, className: t.className})),
            buttons: Array.from(f.querySelectorAll('button, input[type=submit]')).map(b => ({
                tag: b.tagName, className: b.className, text: b.innerText?.trim().substring(0,30), type: b.type, name: b.name
            })),
            hiddenInputs: Array.from(f.querySelectorAll('input[type=hidden]')).map(i => ({name: i.name, value: i.value?.substring(0,50)}))
        })).filter(f => f.textareas.length > 0 || f.action?.includes('pazintys'));

        // Rasti "Rašyti žinutę" ar "Siųsti" nuorodas
        const sendLinks = Array.from(document.querySelectorAll('a, button')).filter(el => {
            const t = (el.innerText + el.getAttribute('href') + el.className + el.getAttribute('onclick') + el.getAttribute('title')).toLowerCase();
            return t.includes('rašyt') || t.includes('zinute') || t.includes('siųst') || t.includes('message') || t.includes('thread');
        }).map(el => ({
            tag: el.tagName, text: el.innerText?.trim().substring(0,40),
            href: el.getAttribute('href'), className: el.className,
            onclick: el.getAttribute('onclick'), title: el.getAttribute('title')
        }));

        return { forms, sendLinks };
    });

    console.log('Formos su textarea:', JSON.stringify(profileData.forms, null, 2));
    console.log('Siųsti nuorodos:', JSON.stringify(profileData.sendLinks, null, 2));

    // 2. Thread žinutės puslapio forma
    console.log('\n== Thread žinutės forma (174998641) ==');
    await page.goto('https://pazintys.draugas.lt/zinutes/message/list?threadid=174998641', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => document.querySelectorAll('[id*="didomi"],.helpbox').forEach(e => e.remove()));

    const threadData = await page.evaluate(() => {
        const forms = Array.from(document.querySelectorAll('form')).map(f => ({
            action: f.action, method: f.method, id: f.id, className: f.className,
            textareas: Array.from(f.querySelectorAll('textarea')).map(t => ({id: t.id, name: t.name, className: t.className, placeholder: t.placeholder})),
            buttons: Array.from(f.querySelectorAll('button, input[type=submit]')).map(b => ({
                tag: b.tagName, className: b.className, text: b.innerText?.trim().substring(0,30), type: b.type, name: b.name, id: b.id
            })),
            hiddenInputs: Array.from(f.querySelectorAll('input[type=hidden]')).map(i => ({name: i.name, value: i.value?.substring(0,50)}))
        }));

        const pageSnippet = document.body.innerText.substring(0, 400);
        const url = window.location.href;
        return { forms, pageSnippet, url };
    });

    console.log('URL:', threadData.url);
    console.log('Puslapis:', threadData.pageSnippet);
    console.log('Formos:', JSON.stringify(threadData.forms, null, 2));

    // 3. Thread sąrašas - rasti visus thread ID
    console.log('\n== Thread sąrašas su ID ==');
    await page.goto('https://pazintys.draugas.lt/zinutes/thread/list', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    const threadList = await page.evaluate(() => {
        const threadLinks = Array.from(document.querySelectorAll('a')).filter(a =>
            a.href.includes('threadid') || a.href.includes('thread/') || a.href.includes('message/list')
        ).map(a => ({text: a.innerText?.trim().substring(0,50), href: a.href}));

        // Ieškoti thread item
        const allLinks = Array.from(document.querySelectorAll('a[href*="threadid"], a[href*="message/list"]'))
            .map(a => ({text: a.innerText?.trim().substring(0,50), href: a.href}));

        return { threadLinks, allLinks, bodySnippet: document.body.innerText.substring(0, 600) };
    });

    console.log('Thread linkai:', JSON.stringify(threadList.threadLinks, null, 2));
    console.log('Message linkai:', JSON.stringify(threadList.allLinks, null, 2));
    console.log('Inbox turinys:', threadList.bodySnippet);

    await browser.close();
})().catch(console.error);
