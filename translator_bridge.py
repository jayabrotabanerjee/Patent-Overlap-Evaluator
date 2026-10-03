from __future__ import annotations

import base64
import logging
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from pathlib import Path

import fitz
import img2pdf
import selenium
from flask import Flask, jsonify, request, send_file
from PIL import Image
from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager

PAGE_RENDER_DPI = 250
DELAY_BETWEEN_PAGES = 2.0
UPLOAD_WAIT_TIMEOUT = 60
MAX_RETRIES_PER_PAGE = 3
RETRY_BACKOFF_SECONDS = 3.0
DOWNLOAD_TIMEOUT = 30
CLIPBOARD_PASTE_CONFIRM_TIMEOUT = 8
CLIPBOARD_PERMISSION_ORIGIN = "https://translate.google.com"
TRANSLATE_URL_TEMPLATE = "https://translate.google.com/?sl={source}&tl={target}&op=images&hl=en"
BRIDGE_VERSION = "2.0"
HOST = "127.0.0.1"
PORT = 8765
LOG_PATH = Path(__file__).with_name("translator_bridge.log")

DOWNLOAD_BUTTON_SPECS = [
    (By.XPATH, "//*[normalize-space(.)='Download translation' and string-length(normalize-space(.)) < 80]"),
    (By.XPATH, "//*[contains(normalize-space(.), 'Download translation') and string-length(normalize-space(.)) < 80]"),
    (By.XPATH, "//*[contains(@aria-label, 'Download translation')]"),
    (By.XPATH, "//*[contains(@aria-label, 'Download')]"),
    (By.CSS_SELECTOR, "[aria-label*='Download translation']"),
    (By.CSS_SELECTOR, "a[download]"),
]

CONSENT_BUTTON_SPECS = [
    (By.XPATH, "//button//*[normalize-space(.)='Accept all']/ancestor::button"),
    (By.XPATH, "//button[normalize-space(.)='Accept all']"),
    (By.XPATH, "//button//*[normalize-space(.)='I agree']/ancestor::button"),
    (By.XPATH, "//button[normalize-space(.)='I agree']"),
    (By.XPATH, "//button//*[normalize-space(.)='Agree']/ancestor::button"),
]

BLOB_CAPTURE_INIT_JS = r"""
window.__poeBlobUrls = window.__poeBlobUrls || [];
if (!window.__poePatchedCreateObjectURL) {
    var orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function(obj) {
        var url = orig(obj);
        window.__poeBlobUrls.push(url);
        return url;
    };
    window.__poePatchedCreateObjectURL = true;
}
"""

JS_FIND_HREF_NEAR = r"""
var el = arguments[0];
function searchUp(node) {
    var cur = node;
    while (cur) {
        if (cur.tagName === 'A' && cur.href) return cur.href;
        var a = cur.querySelector ? cur.querySelector('a[href]') : null;
        if (a && a.href) return a.href;
        cur = cur.parentElement;
    }
    return null;
}
return searchUp(el);
"""

JS_FIND_LARGEST_IMAGE_SRC = r"""
var imgs = Array.from(document.images || []);
var candidates = imgs.filter(function(i) {
    return i && i.src && (i.src.startsWith('blob:') || i.src.startsWith('data:image/'));
});
candidates.sort(function(a,b) {
    return ((b.naturalWidth||b.width||0)*(b.naturalHeight||b.height||0)) -
           ((a.naturalWidth||a.width||0)*(a.naturalHeight||a.height||0));
});
return candidates.length ? candidates[0].src : null;
"""

JS_FETCH_AS_DATA_URL = r"""
var url = arguments[0];
var callback = arguments[arguments.length - 1];
fetch(url).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.blob();
}).then(function(blob) {
    var reader = new FileReader();
    reader.onloadend = function() { callback(reader.result); };
    reader.onerror = function() { callback('ERROR:reader_failed'); };
    reader.readAsDataURL(blob);
}).catch(function(e) { callback('ERROR:' + e); });
"""

JS_CLIPBOARD_WRITE_PNG = r"""
var base64Data = arguments[0];
var callback = arguments[arguments.length - 1];
try {
    var byteChars = atob(base64Data);
    var byteNumbers = new Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
    }
    var byteArray = new Uint8Array(byteNumbers);
    var blob = new Blob([byteArray], { type: "image/png" });
    var item = new ClipboardItem({ "image/png": blob });
    navigator.clipboard.write([item]).then(function() {
        callback(true);
    }).catch(function(e) {
        callback("ERROR:" + e);
    });
} catch (e) {
    callback("ERROR:" + e);
}
"""

app = Flask(__name__)
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
bridge_events: list[str] = []
bridge_events_lock = threading.Lock()

logger = logging.getLogger("poe-translator")
logger.setLevel(logging.INFO)
logger.handlers.clear()
_formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
_console = logging.StreamHandler(sys.stdout)
_console.setFormatter(_formatter)
logger.addHandler(_console)
try:
    _file_handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
    _file_handler.setFormatter(_formatter)
    logger.addHandler(_file_handler)
except Exception:
    pass


def timestamp() -> str:
    return time.strftime("%H:%M:%S")


def bridge_log(message: str, level: str = "INFO", job_id: str | None = None):
    line = f"[{timestamp()}] {level}: {message}"
    with bridge_events_lock:
        bridge_events.append(line)
        del bridge_events[:-300]
    if level == "ERROR":
        logger.error(message)
    elif level == "WARN":
        logger.warning(message)
    else:
        logger.info(message)
    if job_id:
        with jobs_lock:
            job = jobs.get(job_id)
            if job is not None:
                job.setdefault("logs", []).append(line)
                job["logs"] = job["logs"][-250:]


def allowed_origin(origin: str) -> str:
    if origin.startswith("https://jayabrotabanerjee.github.io"):
        return origin
    if origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1"):
        return origin
    return "https://jayabrotabanerjee.github.io"


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    response.headers["Access-Control-Allow-Origin"] = allowed_origin(origin)
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Cache-Control"] = "no-store"
    return response


def find_chrome_executable() -> str | None:
    env_path = os.environ.get("CHROME_PATH")
    if env_path and Path(env_path).exists():
        return env_path

    candidates = []
    for env_name in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        base = os.environ.get(env_name)
        if base:
            candidates.append(Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe")
            candidates.append(Path(base) / "Chromium" / "Application" / "chrome.exe")
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    for name in ("chrome", "chrome.exe", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    return None


def free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


def wait_for_port(port: int, timeout: float = 20.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.4)
            try:
                sock.connect((HOST, port))
                return True
            except OSError:
                time.sleep(0.25)
    return False


def diagnostics_payload():
    chrome = find_chrome_executable()
    return {
        "ok": True,
        "service": "Patent Overlap Evaluator Local Translation Bridge",
        "method": "Visible Chrome -> Google Translate Images -> sequential page translation -> PDF compilation",
        "version": BRIDGE_VERSION,
        "python": sys.version.split()[0],
        "selenium": getattr(selenium, "__version__", "unknown"),
        "platform": platform.platform(),
        "chrome_path": chrome or "",
        "chrome_found": bool(chrome),
        "log_file": str(LOG_PATH),
        "port": PORT,
    }


@app.route("/health", methods=["GET", "OPTIONS"])
def health():
    if request.method == "OPTIONS":
        return ("", 204)
    return jsonify(diagnostics_payload())


@app.route("/api/diagnostics", methods=["GET", "OPTIONS"])
def diagnostics():
    if request.method == "OPTIONS":
        return ("", 204)
    payload = diagnostics_payload()
    with bridge_events_lock:
        payload["events"] = list(bridge_events[-100:])
    return jsonify(payload)


def update_job(job_id: str, **updates):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(updates)


def cancelled(job_id: str) -> bool:
    with jobs_lock:
        return bool(jobs.get(job_id, {}).get("cancel_requested"))


def pdf_to_images(pdf_path: str, out_dir: Path, job_id: str) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf_path)
    zoom = PAGE_RENDER_DPI / 72
    matrix = fitz.Matrix(zoom, zoom)
    image_paths: list[Path] = []
    bridge_log(f"PDF opened: {len(doc)} page(s). Rendering at {PAGE_RENDER_DPI} DPI.", job_id=job_id)
    try:
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            img_path = out_dir / f"page_{i + 1:04d}.png"
            pix.save(str(img_path))
            image_paths.append(img_path)
            bridge_log(
                f"Rendered page {i + 1}/{len(doc)} -> {img_path.name} ({pix.width}x{pix.height}).",
                job_id=job_id,
            )
    finally:
        doc.close()
    return image_paths


def launch_visible_chrome(initial_url: str, work_dir: Path, download_dir: Path, job_id: str):
    chrome_path = find_chrome_executable()
    if not chrome_path:
        raise RuntimeError(
            "Google Chrome was not found. Install Chrome or set the CHROME_PATH environment variable."
        )

    profile_dir = work_dir / "chrome-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    download_dir.mkdir(parents=True, exist_ok=True)
    debug_port = free_tcp_port()

    args = [
        chrome_path,
        f"--remote-debugging-port={debug_port}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-notifications",
        "--disable-popup-blocking",
        "--start-maximized",
        initial_url,
    ]

    bridge_log(f"Opening Chrome manually: {chrome_path}", job_id=job_id)
    bridge_log(f"Chrome remote-debugging port: {debug_port}", job_id=job_id)
    process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if not wait_for_port(debug_port, timeout=20):
        try:
            process.terminate()
        except Exception:
            pass
        raise RuntimeError(
            "Chrome opened but its DevTools debugging port did not become available within 20 seconds."
        )

    attach_options = webdriver.ChromeOptions()
    attach_options.debugger_address = f"{HOST}:{debug_port}"

    driver = None
    first_error = None
    try:
        bridge_log("Attaching Selenium to the already-open Chrome using Selenium Manager...", job_id=job_id)
        driver = webdriver.Chrome(options=attach_options)
    except Exception as exc:
        first_error = exc
        bridge_log(
            "Selenium Manager attach failed; trying webdriver-manager fallback: " + str(exc),
            level="WARN",
            job_id=job_id,
        )
        try:
            service = ChromeService(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=attach_options)
        except Exception as exc2:
            try:
                process.terminate()
            except Exception:
                pass
            raise RuntimeError(
                "Could not attach Selenium to visible Chrome. "
                f"Selenium Manager error: {first_error}. webdriver-manager error: {exc2}"
            )

    driver.set_script_timeout(30)
    bridge_log("Selenium attached to visible Chrome successfully.", job_id=job_id)

    try:
        driver.execute_cdp_cmd(
            "Browser.setDownloadBehavior",
            {"behavior": "allow", "downloadPath": str(download_dir), "eventsEnabled": True},
        )
        bridge_log(f"Chrome download directory configured: {download_dir}", job_id=job_id)
    except Exception as exc:
        bridge_log(
            "Browser.setDownloadBehavior failed; trying Page.setDownloadBehavior: " + str(exc),
            level="WARN",
            job_id=job_id,
        )
        try:
            driver.execute_cdp_cmd(
                "Page.setDownloadBehavior",
                {"behavior": "allow", "downloadPath": str(download_dir)},
            )
        except Exception as exc2:
            bridge_log("Could not configure Chrome download folder: " + str(exc2), level="WARN", job_id=job_id)

    return driver, process


def find_first_multi(driver, specs, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        for by, selector in specs:
            try:
                el = driver.find_element(by, selector)
                if el and el.is_displayed():
                    return el
            except NoSuchElementException:
                pass
            except Exception:
                pass
        time.sleep(0.25)
    return None


def dismiss_consent(driver, job_id: str):
    button = find_first_multi(driver, CONSENT_BUTTON_SPECS, timeout=2)
    if not button:
        return
    try:
        button.click()
        bridge_log("Dismissed Google consent dialog.", job_id=job_id)
        time.sleep(0.8)
    except Exception as exc:
        bridge_log("Consent dialog detected but could not be clicked: " + str(exc), level="WARN", job_id=job_id)


def wait_document_ready(driver, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if driver.execute_script("return document.readyState") == "complete":
                return True
        except Exception:
            pass
        time.sleep(0.25)
    return False


def fetch_url_as_file(driver, url: str, out_path_no_ext: Path, job_id: str):
    if not url:
        return None
    try:
        result = driver.execute_async_script(JS_FETCH_AS_DATA_URL, url)
    except Exception as exc:
        bridge_log("Could not fetch translated image URL from page context: " + str(exc), level="WARN", job_id=job_id)
        return None
    if not result or not isinstance(result, str) or not result.startswith("data:"):
        bridge_log("Translated image URL did not return a data URL.", level="WARN", job_id=job_id)
        return None
    try:
        header, b64data = result.split(",", 1)
        mime = header.split(";", 1)[0].replace("data:", "")
        ext = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
        }.get(mime, ".png")
        final_path = out_path_no_ext.with_suffix(ext)
        final_path.write_bytes(base64.b64decode(b64data))
        bridge_log(f"Captured translated image from page URL -> {final_path.name}", job_id=job_id)
        return final_path
    except Exception as exc:
        bridge_log("Failed to decode translated image data: " + str(exc), level="WARN", job_id=job_id)
        return None


def snapshot_downloads(download_dir: Path) -> set[str]:
    if not download_dir.exists():
        return set()
    return {p.name for p in download_dir.iterdir() if p.is_file()}


def wait_for_new_download(download_dir: Path, before: set[str], timeout: int, job_id: str):
    end = time.time() + timeout
    while time.time() < end:
        if download_dir.exists():
            files = [p for p in download_dir.iterdir() if p.is_file()]
            ready = [
                p for p in files
                if p.name not in before and not p.name.endswith(".crdownload") and not p.name.endswith(".tmp")
            ]
            if ready:
                ready.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                bridge_log(f"Chrome downloaded translated image -> {ready[0].name}", job_id=job_id)
                return ready[0]
        time.sleep(0.3)
    return None


def capture_translated_image(
    driver,
    download_btn,
    out_path_no_ext: Path,
    download_dir: Path,
    blob_count_before: int,
    job_id: str,
):
    try:
        href = driver.execute_script(JS_FIND_HREF_NEAR, download_btn)
    except Exception:
        href = None
    if href:
        bridge_log("Download element exposes a direct href; attempting in-page capture.", job_id=job_id)
        result = fetch_url_as_file(driver, href, out_path_no_ext, job_id)
        if result is not None:
            return result

    try:
        image_src = driver.execute_script(JS_FIND_LARGEST_IMAGE_SRC)
    except Exception:
        image_src = None
    if image_src:
        bridge_log("Found translated image/blob in page; attempting direct capture before clicking Download.", job_id=job_id)
        result = fetch_url_as_file(driver, image_src, out_path_no_ext, job_id)
        if result is not None:
            return result

    before_files = snapshot_downloads(download_dir)

    try:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", download_btn)
        try:
            download_btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", download_btn)
        bridge_log("Clicked Download translation.", job_id=job_id)
    except Exception as exc:
        bridge_log("Could not click Download translation: " + str(exc), level="WARN", job_id=job_id)
        return None

    target_url = None
    end = time.time() + 10
    while time.time() < end:
        try:
            blob_urls = driver.execute_script("return window.__poeBlobUrls || [];")
        except Exception:
            blob_urls = []
        if len(blob_urls) > blob_count_before:
            target_url = blob_urls[-1]
            break
        downloaded = wait_for_new_download(download_dir, before_files, 1, job_id)
        if downloaded:
            ext = downloaded.suffix or ".png"
            final_path = out_path_no_ext.with_suffix(ext)
            shutil.copy2(downloaded, final_path)
            bridge_log(f"Copied downloaded translation -> {final_path.name}", job_id=job_id)
            return final_path

    if target_url:
        bridge_log("New blob URL detected after Download click.", job_id=job_id)
        result = fetch_url_as_file(driver, target_url, out_path_no_ext, job_id)
        if result is not None:
            return result

    downloaded = wait_for_new_download(download_dir, before_files, DOWNLOAD_TIMEOUT, job_id)
    if downloaded:
        ext = downloaded.suffix or ".png"
        final_path = out_path_no_ext.with_suffix(ext)
        shutil.copy2(downloaded, final_path)
        bridge_log(f"Copied downloaded translation -> {final_path.name}", job_id=job_id)
        return final_path

    bridge_log("No translated image could be captured after clicking Download.", level="WARN", job_id=job_id)
    return None


def grant_clipboard_permissions(driver, job_id: str) -> bool:
    permission_sets = [
        ["clipboardReadWrite", "clipboardSanitizedWrite"],
        ["clipboardReadWrite"],
    ]
    for permissions in permission_sets:
        try:
            driver.execute_cdp_cmd(
                "Browser.grantPermissions",
                {"origin": CLIPBOARD_PERMISSION_ORIGIN, "permissions": permissions},
            )
            bridge_log("Granted Chrome clipboard permissions: " + ", ".join(permissions), job_id=job_id)
            return True
        except Exception as exc:
            bridge_log(
                "Clipboard permission attempt failed (" + ", ".join(permissions) + "): " + str(exc),
                level="WARN",
                job_id=job_id,
            )
    return False


def write_image_to_clipboard_via_cdp(driver, image_path: Path, job_id: str) -> bool:
    b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    try:
        result = driver.execute_async_script(JS_CLIPBOARD_WRITE_PNG, b64)
    except Exception as exc:
        bridge_log("Clipboard write JavaScript failed: " + str(exc), level="WARN", job_id=job_id)
        return False
    if result is True:
        bridge_log(f"Placed {image_path.name} on Chrome clipboard.", job_id=job_id)
        return True
    bridge_log("Chrome clipboard write returned: " + str(result), level="WARN", job_id=job_id)
    return False


def send_ctrl_v_via_cdp(driver, job_id: str):
    ctrl = {
        "type": "rawKeyDown",
        "windowsVirtualKeyCode": 17,
        "code": "ControlLeft",
        "key": "Control",
        "modifiers": 2,
    }
    ctrl_up = {**ctrl, "type": "keyUp", "modifiers": 0}
    v_down = {
        "type": "keyDown",
        "windowsVirtualKeyCode": 86,
        "code": "KeyV",
        "key": "v",
        "text": "v",
        "modifiers": 2,
    }
    v_up = {**v_down, "type": "keyUp"}
    for event in (ctrl, v_down, v_up, ctrl_up):
        driver.execute_cdp_cmd("Input.dispatchKeyEvent", event)
    bridge_log("Dispatched Ctrl+V through Chrome DevTools Protocol.", job_id=job_id)


def paste_image_via_cdp(driver, image_path: Path, job_id: str) -> bool:
    try:
        driver.execute_cdp_cmd("Page.bringToFront", {})
    except Exception:
        pass

    if not write_image_to_clipboard_via_cdp(driver, image_path, job_id):
        return False

    try:
        driver.execute_script("document.body && document.body.focus();")
    except Exception:
        pass

    try:
        send_ctrl_v_via_cdp(driver, job_id)
    except Exception as exc:
        bridge_log("Ctrl+V dispatch failed: " + str(exc), level="WARN", job_id=job_id)
        return False

    # IMPORTANT: Google Translate does not consistently expose the pasted preview as img[src^='blob:'].
    # The previous bridge treated absence of that exact DOM shape as a failed paste. This caused false failures.
    # We now consider the trusted paste dispatched and let the translation/download UI be the confirmation.
    end = time.time() + CLIPBOARD_PASTE_CONFIRM_TIMEOUT
    while time.time() < end:
        if find_first_multi(driver, DOWNLOAD_BUTTON_SPECS, timeout=0.3):
            bridge_log("Google Translate reacted to pasted image; Download translation is visible.", job_id=job_id)
            return True
        try:
            body_text = driver.find_element(By.TAG_NAME, "body").text
            if "Download translation" in body_text:
                bridge_log("Google Translate translation UI detected after paste.", job_id=job_id)
                return True
        except Exception:
            pass
        time.sleep(0.4)

    bridge_log(
        "No immediate DOM confirmation after paste, but the paste was dispatched. Continuing to wait for translation output.",
        level="WARN",
        job_id=job_id,
    )
    return True


def translate_image(
    driver,
    image_path: Path,
    translated_dir: Path,
    download_dir: Path,
    page_index: int,
    total_pages: int,
    source_lang: str,
    target_lang: str,
    job_id: str,
):
    url = TRANSLATE_URL_TEMPLATE.format(source=source_lang, target=target_lang)
    bridge_log(
        f"Page {page_index + 1}/{total_pages}: opening Google Translate Images.",
        job_id=job_id,
    )
    driver.get(url)
    wait_document_ready(driver, timeout=15)
    dismiss_consent(driver, job_id)

    try:
        driver.execute_script(BLOB_CAPTURE_INIT_JS)
        bridge_log("Installed blob-URL capture hook.", job_id=job_id)
    except Exception as exc:
        bridge_log("Blob capture hook could not be installed: " + str(exc), level="WARN", job_id=job_id)

    grant_clipboard_permissions(driver, job_id)

    if not paste_image_via_cdp(driver, image_path, job_id):
        bridge_log(f"Page {page_index + 1}: image paste failed.", level="WARN", job_id=job_id)
        return None

    bridge_log(
        f"Page {page_index + 1}: waiting up to {UPLOAD_WAIT_TIMEOUT}s for translated output.",
        job_id=job_id,
    )
    download_btn = find_first_multi(driver, DOWNLOAD_BUTTON_SPECS, timeout=UPLOAD_WAIT_TIMEOUT)

    if download_btn is None:
        try:
            body = driver.find_element(By.TAG_NAME, "body").text
            bridge_log(
                "Download translation button was not found. Google Translate page text snapshot: "
                + body[:800].replace("\n", " | "),
                level="WARN",
                job_id=job_id,
            )
        except Exception:
            pass
        return None

    bridge_log(f"Page {page_index + 1}: Download translation control found.", job_id=job_id)

    try:
        blob_count_before = driver.execute_script("return (window.__poeBlobUrls || []).length;")
    except Exception:
        blob_count_before = 0

    out_path_no_ext = translated_dir / f"translated_{page_index + 1:04d}"
    return capture_translated_image(
        driver,
        download_btn,
        out_path_no_ext,
        download_dir,
        blob_count_before,
        job_id,
    )


def images_to_pdf(image_paths: list[Path], output_pdf_path: str, job_id: str):
    normalized: list[Path] = []
    for index, p in enumerate(image_paths):
        img = Image.open(p)
        bridge_log(
            f"PDF assembly page {index + 1}/{len(image_paths)}: {p.name} ({img.width}x{img.height}).",
            job_id=job_id,
        )
        if img.mode != "RGB":
            img = img.convert("RGB")
        norm_path = p.with_name(p.stem + "_pdf.jpg")
        img.save(norm_path, "JPEG", quality=95, dpi=(PAGE_RENDER_DPI, PAGE_RENDER_DPI))
        normalized.append(norm_path)

    with open(output_pdf_path, "wb") as f:
        f.write(img2pdf.convert([str(p) for p in normalized]))

    bridge_log(
        f"Compiled {len(normalized)} sequential page image(s) into {Path(output_pdf_path).name}.",
        job_id=job_id,
    )


def run_job(job_id: str, input_pdf: Path, output_pdf: Path, source_lang: str, target_lang: str):
    work_dir = input_pdf.parent / "translate_pdf_work"
    pages_dir = work_dir / "pages"
    translated_dir = work_dir / "translated"
    download_dir = work_dir / "chrome-downloads"
    driver = None
    chrome_process = None

    try:
        bridge_log("Translation job started.", job_id=job_id)
        bridge_log(f"Input PDF: {input_pdf}", job_id=job_id)
        bridge_log(f"Languages: {source_lang} -> {target_lang}", job_id=job_id)

        if work_dir.exists():
            shutil.rmtree(work_dir, ignore_errors=True)
        pages_dir.mkdir(parents=True, exist_ok=True)
        translated_dir.mkdir(parents=True, exist_ok=True)
        download_dir.mkdir(parents=True, exist_ok=True)

        update_job(job_id, status="rendering", progress=0)
        bridge_log("[1/4] Rendering PDF pages sequentially at 250 DPI...", job_id=job_id)
        page_images = pdf_to_images(str(input_pdf), pages_dir, job_id)
        total = len(page_images)
        update_job(job_id, total_pages=total)

        if total == 0:
            raise RuntimeError("The PDF contains no pages.")
        if cancelled(job_id):
            update_job(job_id, status="cancelled")
            return

        initial_url = TRANSLATE_URL_TEMPLATE.format(source=source_lang, target=target_lang)
        update_job(job_id, status="opening_chrome")
        bridge_log("[2/4] Opening a visible Chrome window manually, then attaching Selenium...", job_id=job_id)
        driver, chrome_process = launch_visible_chrome(initial_url, work_dir, download_dir, job_id)

        translated_images: list[Path] = []
        update_job(job_id, status="translating")
        bridge_log("[3/4] Translating page images ONE AT A TIME in order...", job_id=job_id)

        for i, img_path in enumerate(page_images):
            if cancelled(job_id):
                update_job(job_id, status="cancelled")
                bridge_log("Cancel requested; stopping before next page.", level="WARN", job_id=job_id)
                return

            result_path = None
            for attempt in range(1, MAX_RETRIES_PER_PAGE + 1):
                bridge_log(
                    f"Page {i + 1}/{total}: attempt {attempt}/{MAX_RETRIES_PER_PAGE}.",
                    job_id=job_id,
                )
                if attempt > 1:
                    time.sleep(RETRY_BACKOFF_SECONDS)

                try:
                    result_path = translate_image(
                        driver,
                        img_path,
                        translated_dir,
                        download_dir,
                        i,
                        total,
                        source_lang,
                        target_lang,
                        job_id,
                    )
                except Exception as exc:
                    bridge_log(
                        f"Page {i + 1} attempt {attempt} exception: {exc}",
                        level="WARN",
                        job_id=job_id,
                    )
                    bridge_log(traceback.format_exc(limit=4), level="WARN", job_id=job_id)
                    result_path = None

                if result_path is not None and result_path.exists():
                    break

            if result_path is not None and result_path.exists():
                translated_images.append(result_path)
                bridge_log(f"Page {i + 1}/{total}: translated image saved successfully.", job_id=job_id)
            else:
                translated_images.append(img_path)
                bridge_log(
                    f"Page {i + 1}/{total}: all {MAX_RETRIES_PER_PAGE} attempts failed; ORIGINAL PAGE retained.",
                    level="WARN",
                    job_id=job_id,
                )

            update_job(job_id, progress=i + 1)
            if i + 1 < total:
                time.sleep(DELAY_BETWEEN_PAGES)

        update_job(job_id, status="assembling")
        bridge_log("[4/4] Compiling translated/original page images into final PDF in original order...", job_id=job_id)
        images_to_pdf(translated_images, str(output_pdf), job_id)

        update_job(
            job_id,
            status="done",
            progress=total,
            output=str(output_pdf),
            filename=output_pdf.name,
        )
        bridge_log(f"DONE: {output_pdf}", job_id=job_id)

    except Exception as exc:
        update_job(job_id, status="error", error=str(exc))
        bridge_log("JOB ERROR: " + str(exc), level="ERROR", job_id=job_id)
        bridge_log(traceback.format_exc(limit=8), level="ERROR", job_id=job_id)
    finally:
        if driver is not None:
            try:
                driver.quit()
                bridge_log("Selenium session closed.", job_id=job_id)
            except Exception as exc:
                bridge_log("Could not close Selenium cleanly: " + str(exc), level="WARN", job_id=job_id)
        if chrome_process is not None:
            try:
                if chrome_process.poll() is None:
                    chrome_process.terminate()
                    chrome_process.wait(timeout=5)
                bridge_log("Chrome process closed.", job_id=job_id)
            except Exception:
                try:
                    chrome_process.kill()
                except Exception:
                    pass


@app.route("/api/translate", methods=["POST", "OPTIONS"])
def start_translation():
    if request.method == "OPTIONS":
        return ("", 204)

    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return jsonify({"error": "PDF file is required."}), 400
    if not uploaded.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported."}), 400

    source_lang = request.form.get("source_lang", "auto").strip() or "auto"
    target_lang = request.form.get("target_lang", "en").strip() or "en"

    job_id = uuid.uuid4().hex
    job_dir = Path(tempfile.mkdtemp(prefix="poe_translate_"))
    input_pdf = job_dir / "input.pdf"
    safe_base = Path(uploaded.filename).stem or "translated"
    output_pdf = job_dir / f"{safe_base} - Translated.pdf"
    uploaded.save(input_pdf)

    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "total_pages": 0,
            "logs": [],
            "cancel_requested": False,
            "output": None,
            "filename": output_pdf.name,
        }

    bridge_log(
        f"Accepted job {job_id[:8]} for {uploaded.filename} ({source_lang} -> {target_lang}).",
        job_id=job_id,
    )

    threading.Thread(
        target=run_job,
        args=(job_id, input_pdf, output_pdf, source_lang, target_lang),
        daemon=True,
    ).start()

    return jsonify({"job_id": job_id})


@app.route("/api/jobs/<job_id>", methods=["GET", "OPTIONS"])
def job_status(job_id: str):
    if request.method == "OPTIONS":
        return ("", 204)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Unknown job."}), 404
        public = {k: v for k, v in job.items() if k != "output"}
    return jsonify(public)


@app.route("/api/jobs/<job_id>/cancel", methods=["POST", "OPTIONS"])
def cancel_job(job_id: str):
    if request.method == "OPTIONS":
        return ("", 204)
    with jobs_lock:
        if job_id not in jobs:
            return jsonify({"error": "Unknown job."}), 404
        jobs[job_id]["cancel_requested"] = True
    bridge_log("Cancel requested from website.", level="WARN", job_id=job_id)
    return jsonify({"ok": True})


@app.route("/api/jobs/<job_id>/download", methods=["GET", "OPTIONS"])
def download_job(job_id: str):
    if request.method == "OPTIONS":
        return ("", 204)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Unknown job."}), 404
        path = job.get("output")
        filename = job.get("filename") or "translated.pdf"
    if not path or not Path(path).exists():
        return jsonify({"error": "Translated PDF is not ready."}), 409
    bridge_log(f"Serving translated PDF download: {filename}", job_id=job_id)
    return send_file(path, as_attachment=True, download_name=filename, mimetype="application/pdf")


if __name__ == "__main__":
    bridge_log("============================================================")
    bridge_log("Patent Overlap Evaluator Translation Bridge starting.")
    bridge_log("Version: " + BRIDGE_VERSION)
    bridge_log("Method: visible Chrome opened first, sequential Google Translate Images automation, then PDF compilation.")
    bridge_log("Python: " + sys.version.split()[0])
    bridge_log("Selenium: " + getattr(selenium, "__version__", "unknown"))
    bridge_log("Platform: " + platform.platform())
    bridge_log("Chrome: " + (find_chrome_executable() or "NOT FOUND"))
    bridge_log(f"Listening on http://{HOST}:{PORT}")
    bridge_log("Event log file: " + str(LOG_PATH))
    bridge_log("============================================================")
    app.run(host=HOST, port=PORT, threaded=True, use_reloader=False)
