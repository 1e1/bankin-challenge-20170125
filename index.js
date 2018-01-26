// 1e1 - 2.71828183E0+bankin-challenge at gmail.com

const URL = 'https://web.bankin.com/challenge/index.html?start={start}'; // the entry point

const URL_PARAMETER_START = { // config of the URL paramater ?start=
    min: 0,         // first value
    step: 50,       // step
    max: 100100,    // max value (watchdog)
}

const PAGE_CONFIG = {
    nbPageReload: 3,        // number of times the page is reloaded if there is a network error
    loadTimeout: 10123,     // max milliseconds allowed for loading the dom
    scriptTimeout: 30123,   // max milliseconds allowed for onload execution script
    mutableSelector: 'tr, iframe',          // selector of the elements that the scrapper is looking for
    reloadButtonSelector: '#btnGenerate',   // selector of the reload button
}


/* --------------------------------------------------------------------------
 * 
 * CUSTOM PARSER SPECIFIC TO THE TARGET
 *
 * -------------------------------------------------------------------------- */


/**
 * return the transaction list from the frame
 * a TR have to be EXACTLY
 * account | transaction | amountAndCurrency
 * @param {Frame} frame - the frame to parse
 * @return {Array<Object>} transaction list found into the frame
 */
async function getTransactionList(frame) {
    return await frame.evaluate(() => {
        const transactionList = [];
        const tdList = Array.from(document.getElementsByTagName('td'));
        const amountAndCurrencyPattern = /(\D*)(\d[\.\,\s\d]*)(\D*)/;
        
        // iterate from the end of the list
        while (0 !== tdList.length) {
            const amountAndCurrency = tdList.pop().textContent;
            const [, leftCurrency, amount, rightCurrency] = amountAndCurrency.match(amountAndCurrencyPattern);
            const transaction = {
                Currency: (leftCurrency + rightCurrency).trim(),
                Amount: amount.trim(),
                Transaction: tdList.pop().textContent.trim(),
                Account: tdList.pop().textContent.trim(),
            }

            // you can add checkings to filter the transaction
            
            transactionList.push(transaction);
        }

        return transactionList;
    });
}



/* --------------------------------------------------------------------------
 * 
 * CORE CONFIG
 *
 * -------------------------------------------------------------------------- */

String.prototype.format = function(opts) { return this.replace(/\{([^\}]+)\}/g, (match, name) => opts[name]) }

/* -------------------------------------------------------------------------- */


const PUPPETEER = require('puppeteer');
const OS = require('os');

const PUPPETEER_ARGS = {
    ignoreHTTPSErrors: true,
    headless: true,
    devtools: false,
    args: [
        // see https://peter.sh/experiments/chromium-command-line-switches/
        '--0',
        '--aggressive',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-extensions',
        '--enable-fast-unload',
        '--no-default-browser-check',
        '--no-experiments ',
        '--no-first-run',
        '--no-pings',
        '--no-referrers',
    ],
};

const GOTO_OPTIONS = { 
    waitUntil: 'domcontentloaded', 
    timeout: PAGE_CONFIG.loadTimeout,
};

const WAIT_FOR_SELECTOR_OPTIONS = {
    timeout: PAGE_CONFIG.scriptTimeout,
}

const BROWSER_PROMISE = PUPPETEER.launch(PUPPETEER_ARGS);
const NB_PARALLEL_PROCESS_PER_CORE = 8;
const NB_PARALLEL_PROCESS = OS.cpus().length * NB_PARALLEL_PROCESS_PER_CORE;

var TRANSACTION_LIST = [];  // the final result
var IS_CRAWLING = true;     // stop process if false


/* --------------------------------------------------------------------------
 * 
 * CORE WORKFLOW
 *
 * -------------------------------------------------------------------------- */


/**
 * append the transaction list from the frame to the global transaction list
 */
function appendTransactionList(transactionList) {
    TRANSACTION_LIST = TRANSACTION_LIST.concat(transactionList);
}


/**
 * iterate on each frames of the page until a frame contains a transaction list
 * @param {Page} page - the page to parse
 */
async function parseAnyFrame(page) {
    const frames = page.frames();

    let transactionList;
    
    for (let index = 0; index < frames.length; ++index) {
        const frame = frames[index];
        
        transactionList = await getTransactionList(frame);
        
        // stop now if the extractor worked
        if (0 !== transactionList.length) {
            appendTransactionList(transactionList);

            break;
        }
    };

    if (transactionList.length !== URL_PARAMETER_START.step) {
        IS_CRAWLING = false;
    }
}


/**
 * crawl while there is a new URL having transactions
 * @throws Error("network") if a scrapper fails due to a network issue
 * @param {Browser} browser - the browser container
 */
async function crawl(browser) {
    const page = await newPage(browser);

    const reloadButtonSelector = PAGE_CONFIG.reloadButtonSelector;
    const mutableSelector = PAGE_CONFIG.mutableSelector;

    const parse = async () => {
        // click on the reload button if exsits
        page.click(reloadButtonSelector).catch(()=>null);
        
        // trigger on %mutableSelector%
        await page.waitForSelector(mutableSelector, WAIT_FOR_SELECTOR_OPTIONS).catch(()=>null);
        
        // extract the transaction list
        await parseAnyFrame(page);
    }

    do {
        const url = getUrl();

        if (null === url) {
            IS_CRAWLING = false;

            break;
        }
        
        let nbRetry = PAGE_CONFIG.nbPageReload;

        // retry goto(URL) x nbRetry, otherwise it fails
        do {
            try {
                await page.goto(url, GOTO_OPTIONS).then(parse, ()=>--nbRetry);

                nbRetry = -1;
            } catch(ignore) {}
        } while (0 < nbRetry);

        if (0 === nbRetry) {
            throw new Error("An network error occured during the scrapping");
        }
    } while(IS_CRAWLING);
}


/**
 * return the current URL, then increment the start parameter
 * @return {string} url
 */
function getUrl() {
    if (URL_PARAMETER_START.current > URL_PARAMETER_START.max) {
        return null;
    }

    const url = URL.format({start: URL_PARAMETER_START.current});

    URL_PARAMETER_START.current += URL_PARAMETER_START.step;

    return url;
}


/**
 * initialize a new page container
 * @param {Browser} browser - the page browser
 * @return {Page} page container
 */
async function newPage(browser) {
    const page = await browser.newPage();
    
    // dismiss blocking dialog window if exists
    page.on('dialog', async dialog => {
        await dialog.dismiss();
    });
    
    return page;
}


/**
 * manage the parallel work
 * @throws Error("network") if a scrapper fails due to a network issue
 * @param {Promise<Browser>} browserPromise - the browser promise
 */
async function run(browserPromise) {
    const browser = await browserPromise;
    const crawlerPromises = []; // pool of jobs to run in a page

    URL_PARAMETER_START.current = URL_PARAMETER_START.min;

    // start parallelism
    for (processIndex = 0; processIndex < NB_PARALLEL_PROCESS; ++processIndex) {
        const crawlerPromise = crawl(browser);

        crawlerPromises.push(crawlerPromise);
    }

    // shutdown
    await Promise.all(crawlerPromises);
    await browser.close();
}


/* -------------------------------------------------------------------------- */


(async function() {
    await run(BROWSER_PROMISE);

    const theFinalResultForTheChallenge = JSON.stringify(TRANSACTION_LIST);

    console.log(theFinalResultForTheChallenge);

    // be carefull it floods the JSON response
    //console.debug(TRANSACTION_LIST.length + " transactions");
})()
