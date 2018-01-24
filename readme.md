# Banko

Banko is my contribution to the [Bankin's challenge](https://blog.bankin.com/challenge-engineering-web-scrapping-dc5839543117).
I'm very proud to submit my very first NodeJS project/script :) 


## run

```bash
npm install
node index.js
```

For getting the result into a file

```bash
node index.js > output.json
```

For benching the script

```bash
time node index.js
```


## howto

### objective 

The [fake webpage](https://web.bankin.com/challenge/index.html) contains a list of transactions. 
The script have to return a JSON list of these transactions with the following properties: 
- account
- transaction
- amount
- currency


### analyse

The transaction list is rendered into a HTML table: 
`<tr> account | transaction | amountAndCurency </tr>`.

The data can be cought by the following regexp: 

```regex
/<tr>\s*
    <td>(?<account>.*)<\/td>\s*
    <td>(?<transaction>.*)<\/td>\s*
    <td>\s*(?<leftCurrency>\D*)\s*(?<amount>\d(?:.*\d)?)\s*(?<rightCurrency>\D*)\s*<\/td>\s*
<\/tr>/gU
```

If this pattern changes, you have to rewrite the `getTransactionList` function. 

### troubles

I notice the response could be displayed
into the main page or into an iframe. 
The transaction list can be immediately displayed, 
after a while or after clicking (several times?) on a button. 
The browser can trigger a dialog message (like an alert box)
because it detects an error. 


### choices

##### amount is a string
Transforming a string to a float is costly. 
The response as `application/json` will not be lighter. 
Moreover the `amount` is cast as given by the website.
The script doesn't send something to localize the response. 
The mean to unlocalize the data should be store/configure where the URL to scrap is.

##### currency is right or right currency
As the currency alignement is depending to the page's localization.
So, it can be on the left side or the right side. 
On the fake page, the currency is one character on the right side. 

##### direct URL
I notice there is more pages than I can browse. 
The links and the buttons into the page are not exhaustive enough.
There is more transaction pages if I type the full URL.
**The scrapper will not navigate, it scraps directly an URL pattern**. 

##### parallelism
The single scrapping time is the sum of every page.
The parallel scrapping time is the time of the slowest page. 

##### return unordered transaction list
Returning an ordered transaction list is not mandatory.
Let the parallel scrapping shuffle the final result.
Why ordering by transaction label if you prefer sort/filter the list on your favorite attribute?

##### output
The JSON is sent to the console. 
I didn't configure any CLI attributes. 
It's not the exercise ;) 

##### stream
The output could be a stream. 
In this case, write into the stream as soon as an URL is parsed. 
But there is no evalution on a transformation of the results. 

##### append transaction list: concat VS push.apply()
A complete benchmark on jsPerf tells [`Array.concat` is faster than `Array.push.apply`](https://jsperf.com/array-prototype-push-apply-vs-concat/13).


### configuration

- `URL = 'https://web.bankin.com/challenge/index.html?start={start}'` is the pattern of URLs to scrap.
- `URL_PARAMETER_START = {}` defines how the `start` URL parameter is evolving
    - `min : 0` is the starting value
    - `max : 12345` is the maximum value
    - `step : 50` is the increment
- `PAGE_CONFIG = {}` is the custom parameters
    - `nbPageReload : 3` is the number of allowed page reload if there is a network issue like a break wire
    - `loadTimeout : 10000` is the maximum milliseconds allowed for loading the DOM
    - `scriptTimeout : 30000` is the maximum milliseconds allowed for onload execution script
    - `mutableSelector : 'tr, iframe'` is the elements that the scrapper observes
    - `reloadButtonSelector : '#btnGenerate'` is the selector of the reload button
- `NB_PARALLEL_PROCESS = 32` is the number of parallel process (I set 8x the number of cores)

- `async function getTransactionList(frame) { ... }` is the function which extracts the transaction list



### workflow

Simple algo:

```
parsePage(page, url)
--------------------
goto url (reload x%nbPageReload% if there is a network error)
    
click on %reloadButtonSelector% if exists

wait until %mutableSelector% if exists

foreach frame of page do
    lastTransactionList = getTransactionList(frame)
    if lastTransactionList is OK then break
done

append the lastTransactionList to the globalTransactionList
```


Parallelism algo:

```
run(browser)
-------------------
pages = create NB_PARALLEL_PROCESS containers

// first load
foreach pages do
    startParser(page, ƒgetNewURL);
done

// reload scrapper who terminated
do
    page = any terminated page
    success = page scrapped successfully
    restartParser(page, ƒgetNewURL)
until success

// shutdown
wait all running pages
```


### defined functions

##### specific to the target URL

```java
Array<Object> getTransactionList(Frame frame)
```

##### core

```java
void appendTransactionList(Frame frame)
integer parseAnyFrame(Page page) // nb transactions
Array<integer> parsePage(Page page, string url, integer processIndex) // [pid, nb transactions]
Page prepareNewPage(Promise<Page> pagePromise)
Array<Page> preparePageList(Browser browser)
void run(browserPromise) throws Error("network")
```



---
1e1 - 2.71828183E0+bankin-challenge at gmail.com