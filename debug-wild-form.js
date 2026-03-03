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

    await page.goto('https://pazintys.draugas.lt/narys.cfm?narys=9975763', { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(() => document.querySelectorAll('[id*="didomi"],.helpbox').forEach(e => e.remove()));

    const info = await page.evaluate(() => {
        // Textarea ir jos forma
        const textareas = Array.from(document.querySelectorAll('textarea')).map(t => {
            const form = t.closest('form');
            return {
                id: t.id, name: t.name, className: t.className,
                formAction: form?.action,
                formId: form?.id,
                formClass: form?.className,
                formButtons: form ? Array.from(form.querySelectorAll('button, input[type=submit]')).map(b => ({
                    tag: b.tagName, className: b.className, text: b.innerText?.trim(), value: b.value, type: b.type, id: b.id
                })) : [],
                formHTML: form?.outerHTML?.substring(0, 800)
            };
        });

        // Visi "Siųsti" mygtukai
        const sendBtns = Array.from(document.querySelectorAll('button, input[type=submit]')).filter(b =>
            (b.innerText?.includes('Siųsti') || b.className?.includes('create-comment') || b.value?.includes('Siųsti'))
        ).map(b => ({
            tag: b.tagName, className: b.className, text: b.innerText?.trim(), value: b.value,
            formAction: b.closest('form')?.action,
            nearestTextarea: b.closest('form')?.querySelector('textarea')?.className
        }));

        return { textareas, sendBtns };
    });

    console.log('Textareas su formomis:');
    info.textareas.forEach(t => {
        console.log(`\nTextarea: id=${t.id} class=${t.className}`);
        console.log(`  Forma: ${t.formAction} (${t.formClass})`);
        console.log(`  Mygtukai:`, JSON.stringify(t.formButtons));
        console.log(`  Formos HTML:\n${t.formHTML}`);
    });

    console.log('\nSiųsti mygtukai:');
    console.log(JSON.stringify(info.sendBtns, null, 2));
})().catch(console.error);
