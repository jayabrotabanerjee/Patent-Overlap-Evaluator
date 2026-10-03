from __future__ import annotations

import base64
import os
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path

import fitz
import img2pdf
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
CLIPBOARD_PASTE_CONFIRM_TIMEOUT = 10
CLIPBOARD_PERMISSION_ORIGIN = "https://translate.google.com"
TRANSLATE_URL_TEMPLATE = "https://translate.google.com/?sl={source}&tl={target}&op=images"

DOWNLOAD_BUTTON_SPECS = [
    (By.XPATH, "//*[normalize-space(.)='Download translation' and string-length(normalize-space(.)) < 60]"),
    (By.XPATH, "//*[contains(normalize-space(.), 'Download translation') and string-length(normalize-space(.)) < 60]"),
    (By.XPATH, "//*[contains(@aria-label, 'Download translation')]"),
    (By.CSS_SELECTOR, "[aria-label*='Download translation']"),
]

BLOB_CAPTURE_INIT_JS = r"""
window.__blobUrls = window.__blobUrls || [];
if (!window.__patchedCreateObjectURL) {
    var orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function(obj) {
        var url = orig(obj);
        window.__blobUrls.push(url);
        return url;
    };
    window.__patchedCreateObjectURL = true;
}
"""

JS_FIND_HREF_NEAR = r"""
var el = arguments[0];
function search(node) {
    var cur = node;
    while (cur) {
        if (cur.tagName === 'A' && cur.href) return cur.href;
        cur = cur.parentElement;
    }
    return null;
}
var href = search(el);
if (href) return href;
var a = el.querySelector ? el.querySelector('a[href]') : null;
return a ? a.href : null;
"""

JS_FETCH_AS_DATA_URL = r"""
var url = arguments[0];
var callback = arguments[arguments.length - 1];
fetch(url).then(function(r) { return r.blob(); }).then(function(blob) {
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

MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
}

app = Flask(__name__)
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


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
    return response


@app.route("/health", methods=["GET", "OPTIONS"])
def health():
    if request.method == "OPTIONS":
        return ("", 204)
    return jsonify({
        "ok": True,
        "service": "Patent Overlap Evaluator Local Translation Bridge",
        "method": "Google Translate Images via Selenium/CDP",
        "version": "1.0",
    })


def update_job(job_id: str, **updates):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(updates)


def log_job(job_id: str, message: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        job.setdefault("logs", []).append(message)
        job["logs"] = job["logs"][-100:]


def cancelled(job_id: str) -> bool:
    with jobs_lock:
        return bool(jobs.get(job_id, {}).get("cancel_requested"))


def pdf_to_images(pdf_path: str, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf_path)
    zoom = PAGE_RENDER_DPI / 72
    matrix = fitz.Matrix(zoom, zoom)
    image_paths: list[Path] = []
    try:
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=matrix)
            img_path = out_dir / f"page_{i + 1:04d}.png"
            pix.save(str(img_path))
            image_paths.append(img_path)
    finally:
        doc.close()
    return image_paths


def build_driver(headless: bool = True):
    options = webdriver.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1600,1200")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    service = ChromeService(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    driver.set_script_timeout(30)
    return driver


def find_first_multi(driver, specs, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        for by, selector in specs:
            try:
                el = driver.find_element(by, selector)
                if el and el.is_displayed():
                    return el
            except (NoSuchElementException, Exception):
                pass
        time.sleep(0.3)
    return None


def fetch_url_as_file(driver, url: str, out_path_no_ext: Path):
    try:
        result = driver.execute_async_script(JS_FETCH_AS_DATA_URL, url)
    except Exception:
        return None
    if not result or not isinstance(result, str) or not result.startswith("data:"):
        return None
    try:
        header, b64data = result.split(",", 1)
        mime = header.split(";", 1)[0].replace("data:", "")
        ext = MIME_TO_EXT.get(mime, ".png")
        final_path = out_path_no_ext.with_suffix(ext)
        final_path.write_bytes(base64.b64decode(b64data))
        return final_path
    except Exception:
        return None


def capture_translated_image(driver, download_btn, out_path_no_ext: Path, blob_count_before: int):
    try:
        href = driver.execute_script(JS_FIND_HREF_NEAR, download_btn)
    except Exception:
        href = None
    if href:
        result = fetch_url_as_file(driver, href, out_path_no_ext)
        if result is not None:
            return result

    try:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", download_btn)
        try:
            download_btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", download_btn)
    except Exception:
        return None

    target_url = None
    end = time.time() + 10
    while time.time() < end:
        try:
            blob_urls = driver.execute_script("return window.__blobUrls || [];")
        except Exception:
            blob_urls = []
        if len(blob_urls) > blob_count_before:
            target_url = blob_urls[-1]
            break
        time.sleep(0.3)

    if target_url is None:
        try:
            blob_urls = driver.execute_script("return window.__blobUrls || [];")
        except Exception:
            blob_urls = []
        if blob_urls:
            target_url = blob_urls[-1]

    if target_url is None:
        return None
    return fetch_url_as_file(driver, target_url, out_path_no_ext)


def grant_clipboard_permissions(driver, origin: str = CLIPBOARD_PERMISSION_ORIGIN) -> bool:
    try:
        driver.execute_cdp_cmd("Browser.grantPermissions", {
            "origin": origin,
            "permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"],
        })
        return True
    except Exception:
        return False


def write_image_to_clipboard_via_cdp(driver, image_path: Path) -> bool:
    b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    try:
        result = driver.execute_async_script(JS_CLIPBOARD_WRITE_PNG, b64)
    except Exception:
        return False
    return result is True


def send_ctrl_v_via_cdp(driver):
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


def paste_image_via_cdp(driver, image_path: Path) -> bool:
    try:
        driver.execute_cdp_cmd("Page.bringToFront", {})
    except Exception:
        pass
    if not write_image_to_clipboard_via_cdp(driver, image_path):
        return False
    try:
        driver.execute_script("document.body && document.body.focus();")
    except Exception:
        pass
    try:
        send_ctrl_v_via_cdp(driver)
    except Exception:
        return False

    end = time.time() + CLIPBOARD_PASTE_CONFIRM_TIMEOUT
    while time.time() < end:
        try:
            if driver.find_elements(By.CSS_SELECTOR, "img[src^='blob:']"):
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def translate_image(driver, image_path: Path, translated_dir: Path, page_index: int, source_lang: str, target_lang: str):
    url = TRANSLATE_URL_TEMPLATE.format(source=source_lang, target=target_lang)
    driver.get(url)
    time.sleep(1.5)
    try:
        driver.execute_script(BLOB_CAPTURE_INIT_JS)
    except Exception:
        pass

    if not paste_image_via_cdp(driver, image_path):
        return None

    download_btn = None
    end = time.time() + UPLOAD_WAIT_TIMEOUT
    while time.time() < end:
        download_btn = find_first_multi(driver, DOWNLOAD_BUTTON_SPECS, timeout=2)
        if download_btn is not None:
            break
        time.sleep(1)

    if download_btn is None:
        return None

    try:
        blob_count_before = driver.execute_script("return (window.__blobUrls || []).length;")
    except Exception:
        blob_count_before = 0

    out_path_no_ext = translated_dir / f"translated_{page_index + 1:04d}"
    return capture_translated_image(driver, download_btn, out_path_no_ext, blob_count_before)


def images_to_pdf(image_paths: list[Path], output_pdf_path: str):
    normalized: list[Path] = []
    for p in image_paths:
        img = Image.open(p)
        if img.mode != "RGB":
            img = img.convert("RGB")
            norm_path = p.with_name(p.stem + "_rgb.jpg")
            img.save(norm_path, "JPEG", quality=95)
            normalized.append(norm_path)
        else:
            if p.suffix.lower() not in (".jpg", ".jpeg"):
                norm_path = p.with_name(p.stem + "_rgb.jpg")
                img.save(norm_path, "JPEG", quality=95)
                normalized.append(norm_path)
            else:
                normalized.append(p)
    with open(output_pdf_path, "wb") as f:
        f.write(img2pdf.convert([str(p) for p in normalized]))


def run_job(job_id: str, input_pdf: Path, output_pdf: Path, source_lang: str, target_lang: str, show_window: bool):
    work_dir = input_pdf.parent / "translate_pdf_work"
    pages_dir = work_dir / "pages"
    translated_dir = work_dir / "translated"
    try:
        if work_dir.exists():
            shutil.rmtree(work_dir, ignore_errors=True)
        pages_dir.mkdir(parents=True, exist_ok=True)
        translated_dir.mkdir(parents=True, exist_ok=True)

        update_job(job_id, status="rendering", progress=0)
        log_job(job_id, "[1/4] Rendering PDF pages at 250 DPI...")
        page_images = pdf_to_images(str(input_pdf), pages_dir)
        total = len(page_images)
        update_job(job_id, total_pages=total)

        if cancelled(job_id):
            update_job(job_id, status="cancelled")
            return

        log_job(job_id, "[2/4] Launching Chrome/Selenium...")
        update_job(job_id, status="launching_chrome")
        driver = build_driver(headless=not show_window)
        grant_clipboard_permissions(driver)

        translated_images: list[Path] = []
        try:
            log_job(job_id, f"[3/4] Translating each page via Google Translate Images ({source_lang} -> {target_lang})...")
            update_job(job_id, status="translating")
            for i, img_path in enumerate(page_images):
                if cancelled(job_id):
                    update_job(job_id, status="cancelled")
                    return

                result_path = None
                for attempt in range(1, MAX_RETRIES_PER_PAGE + 1):
                    if attempt > 1:
                        log_job(job_id, f"Retry {attempt - 1}/{MAX_RETRIES_PER_PAGE - 1} for page {i + 1}...")
                        time.sleep(RETRY_BACKOFF_SECONDS)
                    result_path = translate_image(
                        driver,
                        img_path,
                        translated_dir,
                        i,
                        source_lang,
                        target_lang,
                    )
                    if result_path is not None:
                        break

                if result_path is not None:
                    translated_images.append(result_path)
                    log_job(job_id, f"Page {i + 1}/{total}: translated.")
                else:
                    translated_images.append(img_path)
                    log_job(job_id, f"Page {i + 1}/{total}: translation failed after 3 attempts; original page retained.")

                update_job(job_id, progress=i + 1)
                time.sleep(DELAY_BETWEEN_PAGES)
        finally:
            driver.quit()

        if not translated_images:
            raise RuntimeError("No pages were processed.")

        update_job(job_id, status="assembling")
        log_job(job_id, "[4/4] Assembling translated pages into PDF...")
        images_to_pdf(translated_images, str(output_pdf))
        shutil.rmtree(work_dir, ignore_errors=True)

        update_job(
            job_id,
            status="done",
            progress=len(page_images),
            output=str(output_pdf),
            filename=output_pdf.name,
        )
        log_job(job_id, f"Done. Output written to {output_pdf.name}")
    except Exception as exc:
        update_job(job_id, status="error", error=str(exc))
        log_job(job_id, "ERROR: " + str(exc))


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
    show_window = request.form.get("show_window", "false").lower() == "true"

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

    threading.Thread(
        target=run_job,
        args=(job_id, input_pdf, output_pdf, source_lang, target_lang, show_window),
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
    return send_file(path, as_attachment=True, download_name=filename, mimetype="application/pdf")


if __name__ == "__main__":
    print("Patent Overlap Evaluator Translation Bridge")
    print("Method: Google Translate Images via Selenium/CDP (matching the supplied PDF Translator EXE)")
    print("Listening on http://127.0.0.1:8765")
    app.run(host="127.0.0.1", port=8765, threaded=True)
