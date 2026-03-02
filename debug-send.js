/**
 * debug-send.js — randa "Rašyti žinutę" mygtuko struktūrą ir patikrina formą
 * Paleidimas: node debug-send.js
 */
require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROFILE_URL = 'https://pazintys.draugas.lt/narys.cfm?narys=9975763'; // Wild / Ieva
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

async function run() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });

    if (fs.existsSync(COOKIES_PATH)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
        await context.addCookies(cookies);
        console.log(`[DEBUG] Įkelti ${cookies.length} cookies`);
    }

    const page = await context.newPage();

    console.log('[DEBUG] Navigacija į profilį...');
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Pašalinti overlayus
    await page.evaluate(() => {
        document.querySelectorAll('[id*="didomi"], .didomi-popup-container, .helpbox')
            .forEach(el => el.remove());
        document.body.style.overflow = 'auto';
    });

    // 1. Surinkti informaciją apie "Rašyti žinutę" nuorodą
    const btnInfo = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('a, button')).filter(el =>
            el.innerText.includes('Rašyti') || el.innerText.includes('žinutę') || el.innerText.includes('Siųsti')
        );
        return candidates.map(el => ({
            tag: el.tagName,
            text: el.innerText.trim(),
            href: el.getAttribute('href'),
            className: el.className,
            onclick: el.getAttribute('onclick'),
            id: el.id
        }));
    });

    console.log('\n=== "Rašyti žinutę" elementai PRIEŠ clickinant ===');
    console.log(JSON.stringify(btnInfo, null, 2));

    await page.screenshot({ path: 'debug_before_click.png' });
    console.log('[DEBUG] Screenshot: debug_before_click.png');

    // 2. Paspausti pirmą rastą mygtuką
    if (btnInfo.length > 0) {
        const firstBtn = btnInfo[0];
        console.log(`\n[DEBUG] Spaudžiamas: ${firstBtn.tag} "${firstBtn.text}" href="${firstBtn.href}" onclick="${firstBtn.onclick}"`);

        const btn = page.locator(`${firstBtn.tag.toLowerCase()}:has-text("Rašyti")`).first();
        await btn.click({ force: true });
        await page.waitForTimeout(3000);

        console.log(`[DEBUG] URL po klikimo: ${page.url()}`);
        await page.screenshot({ path: 'debug_after_click.png' });
        console.log('[DEBUG] Screenshot: debug_after_click.png');

        // 3. Patikrinti ar atsirado forma / textarea
        const formInfo = await page.evaluate(() => {
            const textareas = Array.from(document.querySelectorAll('textarea')).map(ta => ({
                id: ta.id, name: ta.name, placeholder: ta.placeholder,
                className: ta.className, visible: ta.offsetParent !== null
            }));

            const forms = Array.from(document.querySelectorAll('form')).map(f => ({
                id: f.id, action: f.action, className: f.className,
                hasTextarea: !!f.querySelector('textarea')
            }));

            const modals = Array.from(document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"], [id*="modal"], [id*="popup"]')).map(m => ({
                tag: m.tagName, id: m.id, className: m.className,
                visible: m.offsetParent !== null,
                hasTextarea: !!m.querySelector('textarea')
            }));

            return { textareas, forms, modals, url: window.location.href };
        });

        console.log('\n=== FORMA PO KLIKIMO ===');
        console.log('Textareas:', JSON.stringify(formInfo.textareas, null, 2));
        console.log('Forms:', JSON.stringify(formInfo.forms, null, 2));
        console.log('Modals:', JSON.stringify(formInfo.modals, null, 2));
        console.log('URL:', formInfo.url);
    }

    console.log('\n[DEBUG] Baigta. Patikrinkite debug_before_click.png ir debug_after_click.png');
    await page.waitForTimeout(5000); // Laukti 5s kad galėtumėte matyti langą
    await browser.close();
}

run().catch(err => {
    console.error('Klaida:', err.message);
    process.exit(1);
});
