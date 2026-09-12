import importlib.util
import pathlib
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("extract", pathlib.Path(__file__).with_name("extract.py"))
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


class ArchiveSecurityTests(unittest.TestCase):
    def test_rejects_paths_and_active_content(self):
        for name in ["../outside.json", "/absolute.json", "a/b.png", "script.js", "index.html"]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                archive = pathlib.Path(temp) / "input.zip"
                with zipfile.ZipFile(archive, "w") as output:
                    output.writestr(name, "malicious")
                with self.assertRaises(ValueError):
                    extract.extract(archive, pathlib.Path(temp) / "output")

    def test_rejects_symlinks_and_oversized_metadata(self):
        for symlink in [True, False]:
            with self.subTest(symlink=symlink), tempfile.TemporaryDirectory() as temp:
                archive = pathlib.Path(temp) / "input.zip"
                with zipfile.ZipFile(archive, "w") as output:
                    info = zipfile.ZipInfo("capture-1-2.json")
                    if symlink:
                        info.external_attr = 0o120777 << 16
                    output.writestr(info, "target" if symlink else "x" * 100001)
                with self.assertRaises(ValueError):
                    extract.extract(archive, pathlib.Path(temp) / "output")


if __name__ == "__main__":
    unittest.main()
