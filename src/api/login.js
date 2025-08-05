const puppeteer = require('puppeteer');
const path = require('path');

async function login(page, { email, pass, code, proxy }) {
    console.log("Login function called with email:", email, "and password:", pass);
    console.app("Login function called with email:", email, "and password:", pass);

    const timeout = 30 * 60 * 1000;
    page.setDefaultTimeout(timeout);

    // Set navigation timeout separately
    page.setDefaultNavigationTimeout(60000); // 60 seconds navigation timeout

    if (proxy && proxy.username && proxy.password) {
        await page.authenticate({ username: proxy.username, password: proxy.password });
    }

    {
        const targetPage = page;
        await targetPage.setViewport({
            width: 700,
            height: 700
        });
    }

    // Add retry logic for the Amazon login page
    let retries = 3;
    let success = false;

    while (retries > 0 && !success) {
        try {
            console.log(`Attempting to navigate to login page (${retries} attempts left)...`);
            console.app(`Attempting to navigate to login page (${retries} attempts left)...`);
            await page.goto(
                'https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https://www.amazon.com/?ref_=nav_signin&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select&openid.ns=http://specs.openid.net/auth/2.0',
                { waitUntil: 'networkidle2', timeout: 60000 }
            );
            success = true;
        } catch (err) {
            retries--;            if (retries === 0) {
                console.log("Failed to load Amazon login page after multiple attempts.");
                console.app("Failed to load Amazon login page after multiple attempts.");
                throw new Error("FAILED_LOAD_LOGIN_PAGE");
            }
            console.log(`Error loading page: ${err.message}. Retrying...`);
            console.app(`Error loading page: ${err.message}. Retrying...`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // Handle CAPTCHA if present
    if (global.data.parentAcc.geminiKey && global.data.parentAcc.geminiKey != "")
        await handleCapcha(page, timeout);
    try {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Continue shopping)'),
            targetPage.locator('button'),
            targetPage.locator('::-p-xpath(/html/body/div/div[1]/div[3]/div/div/form/div/div/span/span/button)'),
            targetPage.locator(':scope >>> button'),
            targetPage.locator('::-p-text(Continue shopping)')
        ])
            .setTimeout(1000)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 237.39999389648438,
                y: 15.149993896484375,
              },
            });
        await Promise.all(promises);
    } catch (_) {}

    {
        const targetPage = page;
        try {
            await targetPage.locator('#ap_email').fill(email);        
        } catch (error) {
            console.log("Error filling email:", error.message);
            console.app("Error filling email:" + error.message);
            throw new Error("FAILED_FILL_EMAIL");
        }
    }
    {
        const targetPage = page;
        try {
            await targetPage.locator('#continue').click();
            await targetPage.waitForNavigation({ timeout: 60000 });        } catch (error) {
            console.log("Error after clicking continue:", error.message);
            console.app("Error after clicking continue:" + error.message);
            throw new Error("FAILED_CLICK_CONTINUE");
        }
    }
    {
        const targetPage = page;
        try {
            await targetPage.locator('#ap_password').fill(pass);        } catch (error) {
            console.log("Error filling password:", error.message);
            console.app("Error filling password:" + error.message);
            throw new Error("FAILED_FILL_PASSWORD");
        }
    }
    {
        const targetPage = page;
        try {
            await targetPage.locator('#signInSubmit').click();
            let link = await targetPage.url();
            await new Promise(resolve => setTimeout(resolve, 2000));            
            if (link == await targetPage.url()) {
                throw new Error("INCORRECT_PASS");
            }
            {
                const targetPage = page;
                await targetPage.evaluate(() => {
                    return new Promise((resolve) => {
                        if (document.readyState === 'complete') {
                            resolve();
                        } else {
                            window.addEventListener('load', resolve);
                        }
                    });
                });
            }        } catch (error) {
            console.log("Error after clicking sign in:", error.message);
            console.app("Error after clicking sign in:" + error.message);
            throw new Error("FAILED_SIGN_IN");
        }
    }

    // Check if MFA page is displayed
    if (page.url().includes('/ap/mfa')) {
        console.log("MFA page detected. Handling MFA...");
        console.app("MFA page detected. Handling MFA...");

        try {
            let twofactor = require("node-2fa");
            let mfaToken = twofactor.generateToken(code).token;
            console.log("Generated MFA token:", mfaToken);
            console.app("Generated MFA token:" + mfaToken);

            {
                const targetPage = page;
                await targetPage.locator('#auth-mfa-otpcode').fill(mfaToken);
            }

            // Check if "Don't require" option exists and click it
            try {
                const targetPage = page;
                const dontRequireExists = await targetPage.evaluate(() => {
                    const element = document.querySelector("label[for='auth-mfa-remember-device'] span");
                    return element && element.textContent.includes("Don't require");
                });

                if (dontRequireExists) {
                    await targetPage.locator("label[for='auth-mfa-remember-device']").click();
                    console.log("Clicked 'Don't require' option");
                    console.app("Clicked 'Don't require' option");
                }
            } catch (dontRequireError) {
                console.log("'Don't require' option not found or couldn't click, continuing...");
            }

            {
                const targetPage = page;
                await targetPage.locator('#auth-signin-button').click();
                await targetPage.waitForNavigation({ timeout: 60000 });
            }

            console.log("MFA handled successfully");
            console.app("MFA handled successfully");        
        } catch (mfaError) {
            console.log("Error handling MFA:", mfaError.message);
            console.app("Error handling MFA:" + mfaError.message);
            throw new Error("FAILED_MFA");
        }
    }

    {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const targetPage = page;
        // Wait the page to load done
        await targetPage.evaluate(() => {
            return new Promise((resolve) => {
                if (document.readyState === 'complete') {
                    resolve();
                } else {
                    window.addEventListener('load', resolve);
                }
            });
        });
    }

    if (page.url().includes('/ap/accountfixup?clientContext=')) {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Not now)'),
            targetPage.locator('#ap-account-fixup-phone-skip-link'),
            targetPage.locator('::-p-xpath(//*[@id=\\"ap-account-fixup-phone-skip-link\\"])'),
            targetPage.locator(':scope >>> #ap-account-fixup-phone-skip-link'),
            targetPage.locator('::-p-text(Not now)')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 23.662506103515625,
                y: 9.20001220703125,
              },
            });
        await Promise.all(promises);
    }

    try {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-text(Business account)'),
            targetPage.locator("html > body > #a-page > div.a-section > #authportal-center-section > #authportal-main-section > div:nth-of-type(2) > div > #ap-account-switcher-container > div.a-box > div > div > div:nth-of-type(2) > div > [data-test-id='switchableAccounts'] [data-test-id='accountType']"),
            targetPage.locator('::-p-xpath(//*[@data-test-id=\\"accountType\\"])'),
            targetPage.locator(":scope >>> html > body > #a-page > div.a-section > #authportal-center-section > #authportal-main-section > div:nth-of-type(2) > div > #ap-account-switcher-container > div.a-box > div > div > div:nth-of-type(2) > div > [data-test-id='switchableAccounts'] [data-test-id='accountType']")
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 76.03750610351562,
                y: 10,
              },
            });
        await Promise.all(promises);
    } catch (error) {
        console.log("Business account selector not found or not needed, continuing with regular account...");
        console.app("Business account selector not found or not needed, continuing with regular account...");
    }
    {
        const targetPage = page;
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Wait the page to load done
        await targetPage.evaluate(() => {
            return new Promise((resolve) => {
                if (document.readyState === 'complete') {
                    resolve();
                } else {
                    window.addEventListener('load', resolve);
                }
            });
        });

        if( page.url().includes('/ap/signin')) {
            try {
                await puppeteer.Locator.race([
                    targetPage.locator('button[type="submit"].a-button-text[alt="Continue shopping"]'),
                    targetPage.locator('::-p-xpath(//button[@type="submit" and @class="a-button-text" and @alt="Continue shopping"])'),
                    targetPage.locator(':scope >>> button[type="submit"].a-button-text[alt="Continue shopping"]')
                ])
                    .setTimeout(1000)
                    .click();
            } catch (error) {
                throw new Error("ACCOUNT_LOCKED");
            }
        }
    }

    await new Promise((resolve, reject) => {
        let interval = setInterval(() => {
            if (page.url().includes('amazon.com/?') || page.url().length <= 25 || page.url().includes('account-status.amazon.com')) {
                clearInterval(interval);
                resolve();
                return;
            }
        }, 1000);
    });
}

async function handleCapcha(page, timeout) {
    let captchaResolved = false;

    while (!captchaResolved) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        let captchaForm;
        try {
            captchaForm = await page.$('form[action="/errors/validateCaptcha"] img');
        } catch (_) { }

        if (!captchaForm) {
            console.log("No captcha form detected, proceeding...");
            captchaResolved = true;
            return;
        }

        console.log("Captcha detected, attempting to solve...");
        const captchaSrc = await page.evaluate(() => {
            const captchaImage = document.querySelector('form[action="/errors/validateCaptcha"] img');
            return captchaImage ? captchaImage.src : null;
        });

        console.log("Captcha image source:", captchaSrc);
        const resCapcha = await require(path.join(__dirname, "capcha.js"))(captchaSrc);

        if (!resCapcha || !resCapcha.success) {
            console.log("Captcha solution failed, retrying...");
            console.app("Captcha solution failed, retrying...");
            continue;
        }

        console.log("Captcha result:", resCapcha);
        console.app("Captcha result:", resCapcha.captchaCode);

        // Fill in the captcha field
        await puppeteer.Locator.race([
            page.locator('::-p-aria(Type characters)'),
            page.locator('#captchacharacters'),
            page.locator('::-p-xpath(//*[@id=\\"captchacharacters\\"])'),
            page.locator(':scope >>> #captchacharacters')
        ])
            .setTimeout(timeout)
            .click({
                offset: {
                    x: 42.5,
                    y: 11.015625,
                },
            });

        await puppeteer.Locator.race([
            page.locator('::-p-aria(Type characters)'),
            page.locator('#captchacharacters'),
            page.locator('::-p-xpath(//*[@id=\\"captchacharacters\\"])'),
            page.locator(':scope >>> #captchacharacters')
        ])
            .setTimeout(timeout)
            .fill(resCapcha.captchaCode);

        // Submit the captcha
        const promises = [];
        const startWaitingForEvents = () => {
            // Add timeout handling for navigation promises
            promises.push(
                page.waitForNavigation({ timeout: 60000 })
                    .catch(err => {
                        console.log("Navigation timeout after CAPTCHA submission, continuing anyway");
                        console.app("Navigation timeout after CAPTCHA submission, continuing anyway");
                        return null; // Return null to prevent promise rejection
                    })
            );
        }

        await puppeteer.Locator.race([
            page.locator('::-p-aria(Continue shopping)'),
            page.locator('button'),
            page.locator('::-p-xpath(/html/body/div/div[1]/div[3]/div/div/form/div[2]/div/span/span/button)'),
            page.locator(':scope >>> button'),
            page.locator('::-p-text(Continue shopping)')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
                offset: {
                    x: 76.5,
                    y: 6.015625,
                },
            });

        await Promise.all(promises);

        // Check if captcha is still present after submission
        try {
            captchaForm = await page.$('form[action="/errors/validateCaptcha"] img');
            if (captchaForm) {
                console.log("Captcha still present after submission, retrying...");
                console.app("Captcha still present after submission, retrying...");
            } else {
                console.log("Captcha passed successfully!");
                console.app("Captcha passed successfully!");
                captchaResolved = true;
            }
        } catch (e) {
            console.log("Error checking captcha form:", e);
            captchaResolved = true;  // Assume it passed if we can't check
        }
    }
}

module.exports = login;