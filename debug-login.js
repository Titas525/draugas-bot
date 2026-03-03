require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIES_PATH = path.join(__dirname, 'cookies.json');

async function run() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    console.log('Naršoma į draugas.lt...');
    await page.goto('https://www.draugas.lt/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Screenshot prieš loginą
    await page.screenshot({ path: 'debug_login_1_before.png' });
    console.log('Screenshot: debug_login_1_before.png');

    // Rasti visus input laukus
    const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input')).map(i => ({
            type: i.type,
            name: i.name,
            id: i.id,
            className: i.className,
            placeholder: i.placeholder
        }));
    });
    console.log('\nRasti input laukai:');
    inputs.forEach(i => console.log(' -', JSON.stringify(i)));

    // Bandyti pašalinti overlayus
    await page.evaluate(() => {
        document.querySelectorAll('[id*="didomi"], [class*="consent"], [class*="cookie"]')
            .forEach(el => el.remove());
        document.body.style.overflow = 'auto';
        document.body.style.pointerEvents = 'auto';
    });

    // Užpildyti formą
    const email = process.env.DRAUGAS_EMAIL;
    const pass = process.env.DRAUGAS_PASS;

    try {
        // Bandyti skirtingus selektorius
        const selectors = [
            '.email.__loginEmail',
            'input[name="email"]',
            'input[type="email"]',
            '#loginEmail',
            'input[placeholder*="El. paštas"]',
            'input[placeholder*="email"]'
        ];

        let filled = false;
        for (const sel of selectors) {
            const el = page.locator(sel).first();
            if (await el.count() > 0) {
                await el.fill(email, { force: true });
                console.log(`\nEmail įvestas su: ${sel}`);
                filled = true;
                break;
            }
        }
        if (!filled) console.log('\n⚠️  Email laukas nerastas!');

        const passSelectors = [
            '.pass.__loginPassword',
            'input[name="password"]',
            'input[type="password"]',
            '#loginPassword'
        ];

        let passFilled = false;
        for (const sel of passSelectors) {
            const el = page.locator(sel).first();
            if (await el.count() > 0) {
                await el.fill(pass, { force: true });
                console.log(`Slaptažodis įvestas su: ${sel}`);
                passFilled = true;
                break;
            }
        }
        if (!passFilled) console.log('⚠️  Slaptažodžio laukas nerastas!');

        await page.screenshot({ path: 'debug_login_2_filled.png' });
        console.log('Screenshot: debug_login_2_filled.png');

        // Paspausti submit
        const submitSelectors = [
            '.submit',
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Prisijungti")',
            'button:has-text("Įeiti")'
        ];
        for (const sel of submitSelectors) {
            const el = page.locator(sel).first();
            if (await el.count() > 0 && await el.isVisible()) {
                await el.click({ force: true });
                console.log(`Submit paspaustas: ${sel}`);
                break;
            }
        }

        await page.waitForTimeout(4000);
        await page.screenshot({ path: 'debug_login_3_after.png' });
        console.log('Screenshot: debug_login_3_after.png');

        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        console.log('\nPuslapio tekstas po loginimo:\n', bodyText);

        const isLogged = bodyText.includes('Arturas') || bodyText.includes('Artūras') || bodyText.includes('Koreguoti profilį');
        console.log('\nPrisijungta:', isLogged ? '✅ TAIP' : '❌ NE');

        if (isLogged) {
            const cookies = await context.cookies();
            fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
            console.log(`Cookies išsaugotos: ${COOKIES_PATH}`);
        }

    } catch (e) {
        console.error('Klaida:', e.message);
        await page.screenshot({ path: 'debug_login_error.png' });
    }

    console.log('\nBaigta. Naršyklė liks atidaryta 10s...');
    await page.waitForTimeout(10000);
    await browser.close();
}

run().catch(console.error);
