import io
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from parser import parse


class ParsingTests(unittest.TestCase):
    def test_pdf_text_and_page_locations(self):
        data = io.BytesIO()
        pdf = canvas.Canvas(data)
        pdf.drawString(72, 720, "Variables store values.")
        pdf.showPage()
        pdf.drawString(72, 720, "Loops repeat work.")
        pdf.save()
        pages = parse("lesson.pdf", data.getvalue())["pages"]
        self.assertEqual(len(pages), 2)
        self.assertIn("Variables store values.", pages[0]["text"])
        self.assertEqual(pages[1]["source"], {"page": 2})
        self.assertEqual(pages[0]["image"], "")

    def test_images_are_decoded_and_sent_for_visual_reading(self):
        for extension, format in [("png", "PNG"), ("jpg", "JPEG"), ("webp", "WEBP"), ("bmp", "BMP"), ("tiff", "TIFF")]:
            with self.subTest(extension=extension):
                data = io.BytesIO()
                Image.new("RGB", (100, 80), "white").save(data, format)
                page = parse("photo." + extension, data.getvalue())["pages"][0]
                self.assertTrue(page["image"].startswith("data:image/jpeg;base64,"))
                self.assertEqual(page["text"], "")

    def test_corrupt_or_unsupported_files_fail(self):
        for name in ["bad.pdf", "bad.png", "bad.exe"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                parse(name, b"not a document")

    def test_scanned_and_vector_pages_are_not_silently_treated_as_text(self):
        data = io.BytesIO()
        pdf = canvas.Canvas(data)
        pdf.drawImage(ImageReader(Image.new("RGB", (200, 100), "white")), 50, 500)
        pdf.showPage()
        pdf.drawString(72, 720, "Input to output")
        pdf.line(72, 700, 220, 700)
        pdf.save()
        pages = parse("visual.pdf", data.getvalue())["pages"]
        self.assertEqual(len(pages), 2)
        self.assertEqual(pages[0]["text"].strip(), "")
        for page in pages:
            self.assertTrue(page["image"].startswith("data:image/jpeg;base64,"))
        self.assertIn("Input to output", pages[1]["text"])

    def test_multiframe_tiff_preserves_every_page(self):
        data = io.BytesIO()
        Image.new("RGB", (100, 100), "white").save(
            data, "TIFF", save_all=True, append_images=[Image.new("RGB", (100, 100), "black")]
        )
        pages = parse("scan.tif", data.getvalue())["pages"]
        self.assertEqual([p["source"]["page"] for p in pages], [1, 2])
        self.assertNotEqual(pages[0]["image"], pages[1]["image"])

    def test_page_limit_and_encrypted_pdf_fail_explicitly(self):
        from reportlab.lib.pdfencrypt import StandardEncryption
        data = io.BytesIO()
        pdf = canvas.Canvas(data, encrypt=StandardEncryption("secret"))
        pdf.drawString(72, 720, "Private")
        pdf.save()
        with self.assertRaises(ValueError):
            parse("locked.pdf", data.getvalue())
        data = io.BytesIO()
        pdf = canvas.Canvas(data)
        for _ in range(201):
            pdf.showPage()
        pdf.save()
        with self.assertRaises(ValueError):
            parse("long.pdf", data.getvalue())

    @unittest.skipUnless(shutil.which("soffice"), "run in the material-parser Docker image for Office coverage")
    def test_legacy_and_modern_office_preserve_chinese_text_and_visuals(self):
        namespaces = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
                      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
                      'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
                      'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"')
        for extension, filter_name in [("doc", "MS Word 97"), ("docx", "Office Open XML Text"),
                                       ("ppt", "MS PowerPoint 97"), ("pptx", "Impress MS PowerPoint 2007 XML")]:
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                slides = extension.startswith("ppt")
                if slides:
                    body = ('<office:presentation><draw:page draw:name="Page1">'
                            '<draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="4cm">'
                            '<draw:text-box><text:p>变量保存数据 Variables store values</text:p></draw:text-box>'
                            '</draw:frame><draw:line svg:x1="2cm" svg:y1="8cm" svg:x2="10cm" svg:y2="8cm"/>'
                            '</draw:page></office:presentation>')
                else:
                    body = '<office:text><text:p>变量保存数据 Variables store values</text:p></office:text>'
                source = directory / ("lesson.fodp" if slides else "lesson.fodt")
                source.write_text(f'<?xml version="1.0"?><office:document {namespaces} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.{"presentation" if slides else "text"}"><office:body>{body}</office:body></office:document>', encoding="utf-8")
                subprocess.run(["soffice", "-env:UserInstallation=" + (directory / "fixture-profile").as_uri(),
                                "--headless", "--convert-to", extension + ":" + filter_name,
                                "--outdir", temp, str(source)], check=True, timeout=60, capture_output=True)
                raw = (directory / ("lesson." + extension)).read_bytes()
                pages = parse("lesson." + extension, raw)["pages"]
                text = "\n".join(p["text"] for p in pages)
                self.assertIn("Variables store values", text)
                self.assertIn("变量保存数据", text.replace(" ", ""))
                self.assertEqual(pages[0]["source"], {"slide" if slides else "page": 1})
                if slides:
                    self.assertTrue(pages[0]["image"])


if __name__ == "__main__":
    unittest.main()
