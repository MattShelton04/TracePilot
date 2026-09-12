"""Extract only allowlisted, bounded PNG/JSON data from an untrusted artifact.

No archive paths are used as filesystem paths. Call with ZIP OUTPUT_DIRECTORY.
The publisher further restricts names to bounded, validated route IDs.
"""
import pathlib
import re
import stat
import sys
import zipfile


def extract(source, destination):
    destination = pathlib.Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    total = 0
    with zipfile.ZipFile(source) as archive:
        if len(archive.infolist()) > 100:
            raise ValueError("Too many artifact entries")
        for member in archive.infolist():
            name = member.filename
            if not re.fullmatch(r"[a-z0-9-]+\.(png|json)", name):
                raise ValueError("Unexpected artifact path")
            if stat.S_ISLNK(member.external_attr >> 16):
                raise ValueError("Artifact symlink rejected")
            limit = 8_000_000 if name.endswith(".png") else 100_000
            total += member.file_size
            if member.file_size > limit or total > 100_000_000:
                raise ValueError("Artifact exceeds size limit")
            data = archive.read(member)
            if name.endswith(".png"):
                if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
                    raise ValueError("Invalid PNG")
                if int.from_bytes(data[16:20], "big") != 1440 or int.from_bytes(data[20:24], "big") != 960:
                    raise ValueError("Unexpected screenshot dimensions")
            (destination / name).write_bytes(data)


if __name__ == "__main__":
    extract(sys.argv[1], sys.argv[2])
