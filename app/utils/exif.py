import datetime
from pathlib import Path

from PIL import ExifTags
from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS


def _convert_to_degrees(value):
    d, m, s = value
    return float(d) + (float(m) / 60.0) + (float(s) / 3600.0)


def extract_exif(path: Path) -> dict:
    """Best-effort EXIF read. Never raises — callers get a dict of Nones on failure."""
    result = {
        "taken_at": None,
        "gps_lat": None,
        "gps_lon": None,
        "direction_deg": None,
        "direction_source": None,
    }

    try:
        with Image.open(path) as img:
            exif = img.getexif()
    except Exception:
        return result

    if not exif:
        return result

    tag_map = {TAGS.get(k, k): v for k, v in exif.items()}

    # DateTimeOriginal/DateTimeDigitized live in the Exif sub-IFD, not the
    # top-level IFD0 — exif.items() above only covers IFD0 (which holds the
    # much less reliable "DateTime" = file-modified tag), so without this
    # the real shot date was silently missed and every photo fell back to
    # file mtime.
    try:
        exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
    except Exception:
        exif_ifd = None
    exif_tag_map = {TAGS.get(k, k): v for k, v in (exif_ifd or {}).items()}

    dt_str = exif_tag_map.get("DateTimeOriginal") or exif_tag_map.get("DateTimeDigitized") or tag_map.get("DateTime")
    if dt_str:
        try:
            result["taken_at"] = datetime.datetime.strptime(str(dt_str).strip(), "%Y:%m:%d %H:%M:%S")
        except ValueError:
            pass

    try:
        gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
    except Exception:
        gps_ifd = None

    if gps_ifd:
        gps = {GPSTAGS.get(k, k): v for k, v in gps_ifd.items()}

        lat = gps.get("GPSLatitude")
        lat_ref = gps.get("GPSLatitudeRef")
        lon = gps.get("GPSLongitude")
        lon_ref = gps.get("GPSLongitudeRef")
        if lat and lon:
            try:
                lat_deg = _convert_to_degrees(lat)
                lon_deg = _convert_to_degrees(lon)
                if str(lat_ref).upper().startswith("S"):
                    lat_deg = -lat_deg
                if str(lon_ref).upper().startswith("W"):
                    lon_deg = -lon_deg
                result["gps_lat"] = lat_deg
                result["gps_lon"] = lon_deg
            except (TypeError, ValueError, ZeroDivisionError):
                pass

        img_dir = gps.get("GPSImgDirection")
        if img_dir is not None:
            try:
                result["direction_deg"] = float(img_dir) % 360.0
                result["direction_source"] = "exif"
            except (TypeError, ValueError):
                pass

    return result
