# Local Document Translation Bridge

The website itself cannot run Selenium/ChromeDriver because GitHub Pages is a browser-only static host.

This bridge reproduces the methodology extracted from the supplied **PDF Translator.exe**:

1. Render each PDF page to PNG at **250 DPI** with PyMuPDF.
2. Launch Chrome through Selenium.
3. Open Google Translate's image tool at `https://translate.google.com/?sl=SOURCE&tl=TARGET&op=images`.
4. Grant clipboard permissions through Chrome DevTools Protocol (CDP).
5. Write each page PNG to the clipboard and inject a trusted **Ctrl+V** through CDP.
6. Wait up to **60 seconds** for **Download translation**.
7. Extract the translated image using the download href where available, otherwise capture the generated `blob:` URL and fetch it from the page context.
8. Retry each failed page up to **3 times**, with a **3 second** retry backoff and **2 second** delay between pages.
9. If a page still fails, retain the original page so page order is preserved.
10. Reassemble the page images into the translated PDF using img2pdf.

## Windows setup

Install Python 3.11+ and Google Chrome, then double-click:

`start_translator_bridge.bat`

The first run installs the Python dependencies into a local virtual environment and may take a few minutes.

Keep the command window open. The website will connect to:

`http://127.0.0.1:8765`

The bridge listens only on the local machine.
