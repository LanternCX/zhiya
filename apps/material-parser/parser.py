"""Fixed document extraction; no user or model supplied code is executed."""

import base64
import io
import subprocess
import tempfile
import warnings
import json
import sys
from contextlib import closing
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw
from PIL import Image, ImageOps, ImageSequence

MAX_BYTES = 32 * 1024 * 1024
MAX_PAGES = 200
MAX_RESULT_BYTES = 48 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 40_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)


def image_url(image):
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((2400, 2400))
    output = io.BytesIO()
    image.save(output, "JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def office_pdf(source, directory):
    # A separate profile prevents interference between conversions and disables macros.
    profile = directory / "profile"
    (profile / "user").mkdir(parents=True)
    (profile / "user" / "registrymodifications.xcu").write_text(
        '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry">'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
        '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>'
        '</item></oor:items>', encoding="utf-8"
    )
    subprocess.run(
        ["soffice", "-env:UserInstallation=" + profile.as_uri(), "--headless",
         "--nologo", "--nodefault", "--norestore", "--convert-to", "pdf",
         "--outdir", str(directory), str(source)],
        check=True, timeout=90, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    result = source.with_suffix(".pdf")
    if not result.exists() or result.stat().st_size > MAX_BYTES:
        raise ValueError("Office conversion failed or exceeded size limit")
    return result.read_bytes()


def pdf_pages(data, slides=False):
    pages = []
    result_bytes = 0
    with pdfium.PdfDocument(data) as document:
        if not 0 < len(document) <= MAX_PAGES:
            raise ValueError("Document must contain 1 to 200 pages")
        for index in range(len(document)):
            with closing(document[index]) as page:
                with closing(page.get_textpage()) as textpage:
                    text = textpage.get_text_bounded()
                # Render complete visual pages: this includes vector diagrams,
                # grouped shapes and image context, not just embedded bitmaps.
                visual = not text.strip() or any(
                    obj.type != pdfium_raw.FPDF_PAGEOBJ_TEXT
                    for obj in page.get_objects()
                )
                picture = ""
                if visual:
                    width, height = page.get_size()
                    if width <= 0 or height <= 0:
                        raise ValueError("Invalid page dimensions")
                    with closing(page.render(scale=min(2.5, 2400 / max(width, height)))) as bitmap:
                        picture = image_url(bitmap.to_pil())
                pages.append({"text": text, "image": picture,
                              "source": {"slide" if slides else "page": index + 1}})
                result_bytes += len(text.encode("utf-8")) + len(picture)
                if result_bytes > MAX_RESULT_BYTES:
                    raise ValueError("Parsed document exceeds size limit")
    return pages


def parse(name, data):
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Empty or oversized document")
    extension = Path(name).suffix.lower()
    try:
        if extension in {".doc", ".docx", ".ppt", ".pptx"}:
            with tempfile.TemporaryDirectory(prefix="zhiya-parse-") as temp:
                directory = Path(temp)
                source = directory / ("source" + extension)
                source.write_bytes(data)
                pages = pdf_pages(office_pdf(source, directory), extension in {".ppt", ".pptx"})
        elif extension == ".pdf":
            pages = pdf_pages(data)
        elif extension in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
            pages = []
            with Image.open(io.BytesIO(data)) as image:
                if getattr(image, "n_frames", 1) > MAX_PAGES:
                    raise ValueError("Too many image frames")
                for index, frame in enumerate(ImageSequence.Iterator(image)):
                    pages.append({"text": "", "image": image_url(frame), "source": {"page": index + 1}})
                    if sum(len(page["image"]) for page in pages) > MAX_RESULT_BYTES:
                        raise ValueError("Parsed images exceed size limit")
        else:
            raise ValueError("Unsupported document format")
        return {"pages": pages}
    except Exception as error:
        raise ValueError("Document could not be parsed") from error


if __name__ == "__main__":
    try:
        result = parse(sys.argv[1], sys.stdin.buffer.read(MAX_BYTES + 1))
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
    except (ValueError, IndexError):
        sys.exit(1)
