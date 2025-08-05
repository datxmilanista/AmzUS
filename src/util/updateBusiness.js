const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Load data files
const childAccounts = fs.readFileSync(path.join(__dirname, "..", "data", 'acc.txt'), 'utf8')
    .replaceAll("\r", '')
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

const proxies = fs.readFileSync(path.join(__dirname, "..", "data", 'proxies.txt'), 'utf8')
    .replaceAll("\r", '')
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

// Validate proxy count
if (proxies.length === 0) {
    console.log("⚠️ Warning: No proxies found in proxies.txt, running without proxy");
    console.app("⚠️ Warning: No proxies found in proxies.txt, running without proxy");
}

let currentAccountIndex = 0;
let currentProxyIndex = 0;
const maxConcurrentWindows = Math.max(proxies.length, 1); // Tối thiểu 1 thread, tối đa theo số proxy
let activeBrowsers = [];

/**
 * Function to add successful business account to data.json
 */
function addBusinessAccount(email) {
    try {
        const dataPath = path.join(__dirname, "..", "data", "data.json");
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        
        if (!data.businessAccounts) {
            data.businessAccounts = [];
        }
        
        if (!data.businessAccounts.includes(email)) {
            data.businessAccounts.push(email);
            fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
            console.log(`✅ Added ${email} to business accounts list`);
            console.app(`✅ Added ${email} to business accounts list`);
        }
    } catch (error) {
        console.error(`❌ Error adding business account ${email}:`, error.message);
        console.app(`❌ Error adding business account ${email}: ${error.message}`);
    }
}

/**
 * Main function to start business login process
 */
async function updateBusiness() {
    console.log("🚀 Starting Business Login Process...");
    console.app("🚀 Starting Business Login Process...");
    console.log(`📊 Total accounts: ${childAccounts.length}`);
    console.app(`📊 Total accounts: ${childAccounts.length}`);
    console.log(`🌐 Total proxies: ${proxies.length}`);
    console.app(`🌐 Total proxies: ${proxies.length}`);
    console.log(`⚡ Max concurrent windows: ${maxConcurrentWindows}`);
    console.app(`⚡ Max concurrent windows: ${maxConcurrentWindows}`);

    // Process accounts in batches equal to proxy count
    while (currentAccountIndex < childAccounts.length) {
        const batch = [];

        // Create batch of accounts equal to proxy count
        for (let i = 0; i < maxConcurrentWindows && currentAccountIndex < childAccounts.length; i++) {
            batch.push(childAccounts[currentAccountIndex]);
            currentAccountIndex++;
        }

        console.log(`\n🔄 Processing batch: ${batch.length} accounts`);
        console.app(`🔄 Processing batch: ${batch.length} accounts`);

        // Process the batch concurrently
        await processBatch(batch);

        // Dynamic delay based on proxy count (more proxies = less delay)
        if (currentAccountIndex < childAccounts.length) {
            const delayMs = Math.max(500, 2000 - (proxies.length * 100)); // Giảm delay khi có nhiều proxy
            console.log(`⏳ Waiting ${delayMs}ms before next batch...`);
            console.app(`⏳ Waiting ${delayMs}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    console.log("✅ All business logins completed!");
    console.app("✅ All business logins completed!");
    console.log(`📊 Summary: Processed ${childAccounts.length} accounts using ${proxies.length} proxies with ${maxConcurrentWindows} concurrent threads`);
    console.app(`📊 Summary: Processed ${childAccounts.length} accounts using ${proxies.length} proxies with ${maxConcurrentWindows} concurrent threads`);
}

/**
 * Process a batch of accounts concurrently (equal to proxy count)
 */
async function processBatch(accounts) {
    const promises = accounts.map((accountLine, index) => {
        return processAccount(accountLine, index);
    });

    try {
        await Promise.allSettled(promises);
    } catch (error) {
        console.error("❌ Error in batch processing:", error);
        console.app("❌ Error in batch processing:", error.message);
    }
}

/**
 * Process a single account
 */
async function processAccount(accountLine, batchIndex) {
    const [email, pass, secret] = accountLine.split("|");

    if (!email || !pass || !secret) {
        console.log(`⚠️ Invalid account data: ${accountLine}`);
        console.app(`⚠️ Invalid account data: ${accountLine}`);
        return;
    }

    let browser = null;
    let page = null;

    try {
        console.log(`🌐 [${batchIndex + 1}] Starting login for: ${email}`);
        console.app(`🌐 [${batchIndex + 1}] Starting login for: ${email}`);

        // Get proxy if available
        let proxy = null;
        if (proxies.length > 0) {
            const proxyLine = proxies[currentProxyIndex % proxies.length];
            const [host, port, user, proxyPass] = proxyLine.split(':');
            proxy = {
                host: host,
                port: port,
                username: user,
                password: proxyPass
            };
            console.log(`🌐 [${batchIndex + 1}] Using proxy: ${host}:${port} for ${email}`);
            console.app(`🌐 [${batchIndex + 1}] Using proxy: ${host}:${port} for ${email}`);
            currentProxyIndex++;
        } else {
            console.log(`🌐 [${batchIndex + 1}] No proxy available, using direct connection for ${email}`);
            console.app(`🌐 [${batchIndex + 1}] No proxy available, using direct connection for ${email}`);
        }

        // Launch browser
        const launchOptions = {
            headless: !global.data.settings.showBrowser,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--ignore-certificate-errors',
                '--disable-infobars',
                '--disable-dev-shm-usage',
                '--window-size=1200,800',
                '--disable-extensions',
                '--disable-gpu',
                '--disable-save-password-bubble',
                '--disable-autofill-keyboard-accessory-view',
                '--disable-autofill-keyboard-accessory',
                '--disable-translate'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        };

        // Add proxy if available
        if (proxy) {
            launchOptions.args.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
        }

        browser = await puppeteer.launch(launchOptions);
        activeBrowsers.push(browser);

        page = await browser.newPage();

        // Authenticate proxy if needed
        if (proxy && proxy.username && proxy.password) {
            await page.authenticate({
                username: proxy.username,
                password: proxy.password
            });
        }

        // Prepare login form data
        const loginForm = {
            email: email,
            pass: pass,
            code: secret,
            proxy: proxy
        };

        // Call business login function
        console.log(`🔐 [${batchIndex + 1}] Attempting business login for: ${email}`);
        console.app(`🔐 [${batchIndex + 1}] Attempting business login for: ${email}`);

        await require(path.join(__dirname, "..", "api", "business", "login.js"))(page, loginForm);

        console.log(`✅ [${batchIndex + 1}] Successfully logged in: ${email}`);
        console.app(`✅ [${batchIndex + 1}] Successfully logged in: ${email}`);

        // Check if page have elements id 'cvf-filtered-account-switcher-header-text' is exists
        await new Promise(resolve => setTimeout(resolve, 5000));
        const accountSwitcherHeader = await page.evaluate(() => {
            return !!document.querySelector('#cvf-filtered-account-switcher-header-text');
        });

        if (!accountSwitcherHeader) {
            console.log(`🔄 [${batchIndex + 1}] Continuing login for: ${email}`)
            console.app(`🔄 [${batchIndex + 1}] Continuing login for: ${email}`);
            try {
                await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).continueLogin(page, loginForm);
            } catch (error) {
                throw new Error(`This account is already registered or has an error: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).fillInfo(page, loginForm);
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).finalSetup(page, loginForm);
        } else {
            console.log(`🔄 [${batchIndex + 1}] Account switcher header found, selecting business account...`)
            console.app(`🔄 [${batchIndex + 1}] Account switcher header found, selecting business account...`);
            try {
                await page.waitForSelector('[data-test-id="accountType"]', { timeout: 10000 });
                const businessAccounts = await page.$$('[data-test-id="accountType"]');

                for (const account of businessAccounts) {
                    const text = await page.evaluate(el => el.textContent, account);
                    if (text.includes('Business account')) {
                        await account.click();

                        await page.waitForNavigation({ timeout: 30000 }).catch(e =>
                            console.log(`⚠️ [${batchIndex + 1}] Navigation timeout after clicking business account: ${e.message}`)
                        );
                        break;
                    }
                }
            } catch (error) {
                console.error(`❌ [${batchIndex + 1}] Error selecting business account: ${error.message}`);
                console.app(`❌ [${batchIndex + 1}] Error selecting business account: ${error.message}`);
            }
            try {
                console.log(`🔍 [${batchIndex + 1}] Looking for Complete registration button`);
                // Check if "Complete registration" button exists
                const completeRegButton = await page.evaluate(() => {
                    const elements = [
                        document.querySelector('[data-testid="Primary.REGISTRATION_START_COMPLETE_REGISTRATION.redirect"]'),
                        Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Complete registration'))
                    ].filter(Boolean);
                    return elements.length > 0;
                });
                if (completeRegButton) {
                    console.log(`🖱️ [${batchIndex + 1}] Clicking Complete registration button`);
                    await Promise.all([
                        page.waitForNavigation({ timeout: 30000 }).catch(e =>
                            console.log(`⚠️ [${batchIndex + 1}] Navigation timeout after clicking: ${e.message}`)
                        ),
                        page.click('[data-testid="Primary.REGISTRATION_START_COMPLETE_REGISTRATION.redirect"]').catch(() =>
                            page.evaluate(() => {
                                const buttons = Array.from(document.querySelectorAll('button'));
                                const button = buttons.find(el => el.textContent.includes('Complete registration'));
                                if (button) button.click();
                            })
                        )
                    ]);
                    console.log(`✓ [${batchIndex + 1}] Clicked Complete registration button`);
                } else {
                    throw new Error("ACCOUNT_ALREADY_BUSINESS");
                }
            } catch (error) {
                throw new Error(error.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).fillInfo(page, loginForm);
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).finalSetup(page, loginForm);
        }

        console.log(`✅ [${batchIndex + 1}] Business account setup completed for: ${email}`);
        console.app(`✅ [${batchIndex + 1}] Business account setup completed for: ${email}`);

        addBusinessAccount(email);

    } catch (error) {
        if (error.message.includes("Navigating frame was detached")) {
            console.log(`✅ [${batchIndex + 1}] Business account setup completed for: ${email}`);
            console.app(`✅ [${batchIndex + 1}] Business account setup completed for: ${email}`); 
            
            addBusinessAccount(email);
        } else if (error.message.includes("ACCOUNT_ALREADY_BUSINESS")) {
            console.log(`✅ [${batchIndex + 1}] Account is already a business account: ${email}`);
            console.app(`✅ [${batchIndex + 1}] Account is already a business account: ${email}`);
            
            addBusinessAccount(email);
        }
        else{
            console.error(`❌ [${batchIndex + 1}] Error logging in ${email}:`, error.message);
            console.app(`❌ [${batchIndex + 1}] Error logging in ${email}: ${error.message}`);
        }
    } finally {
        // Close browser
        if (browser) {
            try {
                await browser.close();
                // Remove from active browsers list
                const index = activeBrowsers.indexOf(browser);
                if (index > -1) {
                    activeBrowsers.splice(index, 1);
                }
                console.log(`🚪 [${batchIndex + 1}] Browser closed for: ${email}`);
            } catch (closeError) {
                console.error(`⚠️ [${batchIndex + 1}] Error closing browser for ${email}:`, closeError.message);
            }
        }
    }
}

/**
 * Helper function to randomly select an item from array
 */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Cleanup function to close all browsers
 */
async function cleanup() {
    console.log("🧹 Cleaning up browsers...");
    console.app("🧹 Cleaning up browsers...");

    const closePromises = activeBrowsers.map(async (browser) => {
        try {
            await browser.close();
        } catch (error) {
            console.error("Error closing browser:", error);
        }
    });

    await Promise.allSettled(closePromises);
    activeBrowsers = [];

    console.log("✅ Cleanup completed!");
    console.app("✅ Cleanup completed!");
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log("\n🛑 Process interrupted. Cleaning up...");
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log("\n🛑 Process terminated. Cleaning up...");
    await cleanup();
    process.exit(0);
});

module.exports = updateBusiness;