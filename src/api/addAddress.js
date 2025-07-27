const puppeteer = require('puppeteer');
const path = require('path');
const timeout = 30 * 60 * 1000;


async function gotoBook(page) {
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('#glow-ingress-line2'),
            targetPage.locator('::-p-xpath(//*[@id=\\"glow-ingress-line2\\"])'),
            targetPage.locator(':scope >>> #glow-ingress-line2'),
            targetPage.locator('::-p-text(Update location)')
        ])
            .setTimeout(timeout)
            .click({
                offset: {
                    x: 41,
                    y: 11,
                },
            });
    }
    {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Manage address book)'),
            targetPage.locator('#GLUXManageAddressLink > a'),
            targetPage.locator('::-p-xpath(//*[@id=\\"GLUXManageAddressLink\\"]/a)'),
            targetPage.locator(':scope >>> #GLUXManageAddressLink > a'),
            targetPage.locator('::-p-text(Manage address)')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
                offset: {
                    x: 81.69999694824219,
                    y: 4.699981689453125,
                },
            });
        await Promise.all(promises);
    }

    {
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
}

async function checkBook(page) {
    try {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('#ya-myab-display-address-block-0'),
            targetPage.locator('::-p-xpath(//*[@id=\\"ya-myab-display-address-block-0\\"])'),
            targetPage.locator(':scope >>> #ya-myab-display-address-block-0')
        ])
            .setTimeout(1000)
            .click({
                offset: {
                    x: 126,
                    y: 194,
                },
            });

        return true;
    } catch (_) {
        return false;
    }
}

async function addAddress(page) {
    const { getAddress } = await import('random-addresses-generator');
    let addressData = [];

    while (addressData.length < 1) {
        addressData = JSON.parse(await getAddress(5, {
            country: 'USA',
            addressType: 'Resedential',
            format: 'json'
        }));
    }

    {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('div.a-color-tertiary'),
            targetPage.locator('::-p-xpath(//*[@id=\\"ya-myab-address-add-link\\"]/div/div/div[2])'),
            targetPage.locator(':scope >>> div.a-color-tertiary'),
            targetPage.locator('::-p-text(Add Address)')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
                offset: {
                    x: 121.39999961853027,
                    y: 14.199981689453125,
                },
            });
        await Promise.all(promises);
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Phone number)'),
            targetPage.locator('#address-ui-widgets-enterAddressPhoneNumber'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-enterAddressPhoneNumber\\"])'),
            targetPage.locator(':scope >>> #address-ui-widgets-enterAddressPhoneNumber')
        ])
            .setTimeout(timeout)
            .click({
                offset: {
                    x: 43.599998474121094,
                    y: 13.399993896484375,
                },
            });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Phone number)'),
            targetPage.locator('#address-ui-widgets-enterAddressPhoneNumber'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-enterAddressPhoneNumber\\"])'),
            targetPage.locator(':scope >>> #address-ui-widgets-enterAddressPhoneNumber')
        ])
            .setTimeout(timeout)
            .fill(String(541) +
                String(Math.floor(200 + Math.random() * 800)) +
                String(Math.floor(1000 + Math.random() * 9000)));
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Address)'),
            targetPage.locator('#address-ui-widgets-enterAddressLine1'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-enterAddressLine1\\"])'),
            targetPage.locator(':scope >>> #address-ui-widgets-enterAddressLine1'),
            targetPage.locator('::-p-text(202, Poplar Place)')
        ])
            .setTimeout(timeout)
            .click({
                offset: {
                    x: 197.5999984741211,
                    y: 12.399993896484375,
                },
            });
    }

    let checked = false;
    while (!checked) {
        console.log(addressData[0].buildingNo);
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Address)'),
            targetPage.locator('#address-ui-widgets-enterAddressLine1'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-enterAddressLine1\\"])'),
            targetPage.locator(':scope >>> #address-ui-widgets-enterAddressLine1')
        ])
            .setTimeout(timeout)
            .fill(addressData[0].buildingNo + '');

        
        try {    
            await puppeteer.Locator.race([
                targetPage.locator('#awz-address-suggestion-0'),
                targetPage.locator('::-p-xpath(//*[@id=\\"awz-address-suggestion-0\\"])'),
                targetPage.locator(':scope >>> #awz-address-suggestion-0')
            ])
                .setTimeout(2000)
                .click({
                    offset: {
                        x: 328.7999954223633,
                        y: 13.600006103515625,
                    },
                });
            checked = true;
        } catch (_) {
            addressData = [];

            while (addressData.length < 1) {
                addressData = await getAddress(1, {
                    country: 'USA',
                    addressType: 'Resedential',
                    format: 'json'
                });
            }
        }
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Make this my default address)'),
            targetPage.locator('#address-ui-widgets-use-as-my-default'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-use-as-my-default\\"])'),
            targetPage.locator(':scope >>> #address-ui-widgets-use-as-my-default')
        ])
            .setTimeout(timeout)
            .click({
                offset: {
                    x: 4.599998474121094,
                    y: 7.79998779296875,
                },
            });
    }
    {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Add address)'),
            targetPage.locator('span:nth-of-type(3) input'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-form-submit-button\\"]/span/input)'),
            targetPage.locator(':scope >>> span:nth-of-type(3) input')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
                offset: {
                    x: 55.79999542236328,
                    y: 7,
                },
            });
        await Promise.all(promises);
    }
}

module.exports = {
    gotoBook,
    checkBook,
    addAddress
};