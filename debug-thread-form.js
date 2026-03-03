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

    // Deimantės thread
    const THREAD_URL = 'https://pazintys.draugas.lt/zinutes/message/list?threadId=174945160&list=chats';
    console.log('Thread:', THREAD_URL);
    await page.goto(THREAD_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(4000); // Ilgiau laukti JS
    await page.evaluate(() => document.querySelectorAll('[id*="didomi"],.helpbox').forEach(e => e.remove()));

    const data = await page.evaluate(() => {
        // Visos textareas
        const textareas = Array.from(document.querySelectorAll('textarea')).map(t => ({
            id: t.id, name: t.name, className: t.className, placeholder: t.placeholder,
            visible: t.offsetParent !== null, value: t.value.substring(0,50)
        }));

        // Visi mygtukai
        const buttons = Array.from(document.querySelectorAll('button, input[type=submit]')).map(b => ({
            tag: b.tagName, className: b.className, text: b.innerText?.trim().substring(0,30),
            type: b.type, id: b.id, name: b.name, onclick: b.getAttribute('onclick')
        }));

        // Formos
        const forms = Array.from(document.querySelectorAll('form')).map(f => ({
            action: f.action, method: f.method, id: f.id, className: f.className,
            textareas: Array.from(f.querySelectorAll('textarea')).length,
            buttons: Array.from(f.querySelectorAll('button, input[type=submit]')).map(b => b.className)
        }));

        // Pokalbio žinutės
        const messages = Array.from(document.querySelectorAll('.message, .msg, .chat-message, .thread-message, [class*="message"]'))
            .slice(0,5).map(m => ({className: m.className, text: m.innerText?.substring(0,100)}));

        const bodySnippet = document.body.innerText.substring(0, 300);
        return { textareas, buttons, forms, messages, bodySnippet, url: window.location.href };
    });

    console.log('URL:', data.url);
    console.log('Textareas:', JSON.stringify(data.textareas, null, 2));
    console.log('Mygtukai:', JSON.stringify(data.buttons, null, 2));
    console.log('Formos:', JSON.stringify(data.forms, null, 2));
    console.log('Žinutės elementai:', JSON.stringify(data.messages, null, 2));
    console.log('Puslapis:', data.bodySnippet);

    await browser.close();
})().catch(console.error);
