# Document Translation Bridge

This bridge exists because GitHub Pages cannot start Selenium, ChromeDriver, or a local Chrome process directly.

The current bridge intentionally follows the workflow extracted from the supplied PDF Translator application.

## Translation sequence

1. The uploaded PDF is rendered **page-by-page at 250 DPI** using PyMuPDF.
2. The bridge locates the installed Google Chrome executable.
3. It **opens a normal visible Chrome window first** using a temporary Chrome profile and a local DevTools debugging port.
4. Selenium attaches to that already-open Chrome session.
5. For page 1, the bridge opens Google Translate's **Images** mode with the requested source/target language.
6. The rendered PNG is written to Chrome's clipboard.
7. A trusted **Ctrl+V** is dispatched through Chrome DevTools Protocol.
8. The bridge waits for **Download translation**.
9. The translated image is captured using, in order:
   - a direct href exposed by the download control;
   - a translated blob/data-image already present in the page;
   - a new blob URL created after the download click;
   - the actual Chrome download directory as a final fallback.
10. The same steps run **sequentially for page 2, page 3, and so on**.
11. A failed page is retried up to **3 times**, with a **3-second retry backoff**.
12. There is a **2-second delay between pages**.
13. If all 3 attempts fail, the original page image is retained rather than dropping the page.
14. After every page is processed, the page images are compiled in their original order into the final translated PDF using img2pdf.

## Important debug fix

The earlier bridge required Google Translate to expose the pasted preview specifically as:

`img[src^="blob:"]`

Google Translate does not reliably use that exact DOM representation. That made a successful clipboard paste look like a failed paste.

The new bridge treats successful clipboard write + CDP Ctrl+V dispatch as the paste event, then waits for Google Translate's translation/download UI. This removes that false-failure condition.

The previous version could also run Chrome headlessly. The current version always opens a **visible Chrome window** so you can watch each page enter Google Translate and see exactly where a failure occurs.

## Event logs

There are two copies of the debug log:

- **Website:** Document Translation → Translation Event Logs
- **Local file:** `translator_bridge.log` next to `translator_bridge.py`

The log records:

- bridge startup;
- detected Python, Selenium and Chrome path;
- PDF render size for every page;
- Chrome process launch;
- DevTools port;
- Selenium attachment;
- clipboard permissions;
- clipboard image write;
- Ctrl+V dispatch;
- consent-dialog handling;
- translation wait;
- download-button detection;
- image capture path;
- retries;
- original-page fallback;
- final PDF assembly.

## Windows setup

Put these files in the same folder:

- `start_translator_bridge.bat`
- `translator_bridge.py`
- `translator_bridge_requirements.txt`

Install:

- Python 3.11 or newer
- Google Chrome

Then double-click:

`start_translator_bridge.bat`

Keep the window open.

In Patent Overlap Evaluator, click **Check Bridge**. It should report:

- Bridge Connected
- detected Chrome path
- Python version
- Selenium version

Then upload the PDF and click **Translate PDF**.

A visible Chrome window should open automatically.

## If Check Bridge says offline

Open this directly in Chrome:

`http://127.0.0.1:8765/health`

You should see JSON. If you do not, inspect the command window and `translator_bridge.log`.

## If Chrome does not open

Check the event log for:

`Chrome: NOT FOUND`

If Chrome is installed in a non-standard location, set a `CHROME_PATH` environment variable pointing to `chrome.exe`, then restart the bridge.

## If Chrome opens but Selenium cannot attach

The event log will show both the Selenium Manager error and the webdriver-manager fallback error. Update Chrome, restart the bridge, and rerun the job.

## If the image appears but no translated image is captured

Watch the visible Chrome window. The event log will indicate whether:

- clipboard write succeeded;
- Ctrl+V was dispatched;
- the download control appeared;
- a blob/data image was found;
- Chrome downloaded a file.

That makes the exact failure stage visible instead of returning a generic bridge error.
