/**
 * test-send-one.js — siunčia VIENĄ žinutę į konkretų profilį
 * Testuoja naują sendMessage logiką (Playwright fill + create-comment button)
 * Paleidimas: node test-send-one.js
 */
require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const PROFILE_URL = 'https://pazintys.draugas.lt/narys.cfm?narys=1254346'; // Loreta (40 m., Kaunas)
const TEST_MESSAGE = 'Labas, Loreta! 👋 Kaip sekasi šį pirmadienį?';

async function run() {
    console.log('=== TEST: Žinutės siuntimas ===');
    console.log(`Profilis: ${PROFILE_URL}`);
    console.log(`Žinutė: "${TEST_MESSAGE}"`);

    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });

    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
    await ctx.addCookies(cookies);
    console.log(`[OK] Cookies: ${cookies.length}`);

    const page = await ctx.newPage();

    // Nueiti į profilį
    console.log('\n[1] Navigacija į profilį...');
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Pašalinti overlayus
    await page.evaluate(() => {
        ['[id*="didomi"]', '.didomi-popup-container', '.helpbox'].forEach(sel =>
            document.querySelectorAll(sel).forEach(el => el.remove())
        );
        document.body.style.overflow = 'auto';
        document.body.style.pointerEvents = 'auto';
    });

    console.log(`[2] URL: ${page.url()}`);
    await page.screenshot({ path: 'test_step1_profile.png' });

    // Rasti textarea
    const textarea = page.locator('textarea').first();
    const taCount = await textarea.count();
    console.log(`[3] Textarea skaičius: ${taCount}`);

    if (taCount === 0) {
        console.error('[KLAIDA] Textarea nerasta!');
        await browser.close();
        return;
    }

    // Įvesti žinutę
    try {
        await textarea.scrollIntoViewIfNeeded({ timeout: 5000 });
        await textarea.click({ force: true, timeout: 5000 });
        await textarea.fill(TEST_MESSAGE);
        console.log('[4] ✅ Žinutė įvesta per fill()');
    } catch (e) {
        console.error('[KLAIDA] fill() nepavyko:', e.message);
        await browser.close();
        return;
    }

    await page.screenshot({ path: 'test_step2_filled.png' });
    console.log('[OK] Screenshot: test_step2_filled.png');

    // Rasti ir spausti mygtuką
    const sendBtn = page.locator('button.create-comment, button[type="submit"], input[type="submit"]').first();
    const btnCount = await sendBtn.count();
    console.log(`[5] Siuntimo mygtukas rastas: ${btnCount}`);

    if (btnCount > 0) {
        await sendBtn.click({ force: true });
        console.log('[5] ✅ Mygtukas paspaustas');
    } else {
        await page.keyboard.press('Enter');
        console.log('[5] Fallback: Enter');
    }

    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'test_step3_after.png' });
    console.log('\n=== BAIGTA ===');
    console.log('Patikrinkite:');
    console.log('  - test_step2_filled.png (žinutė įvesta)');
    console.log('  - test_step3_after.png (po siuntimo)');
    console.log('  - Draugas.lt profilį: ar žinutė išsiųsta');

    await page.waitForTimeout(5000);
    await browser.close();
}

run().catch(e => { console.error('Klaida:', e.message); process.exit(1); });
